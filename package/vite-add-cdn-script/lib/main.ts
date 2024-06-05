import path from "path";
import fs from "fs";
import { PluginOption } from "vite";
import { getPackageURL, getPackageVersion } from "./utils";
import { PropertyCdn } from "./types";

enum EEnforce {
  PRE = "pre",
  POST = "post",
}

export interface IOptions {
  protocol?: string;
  customScript?: { [key: string]: string };
  customFilepath?: { [key: string]: string };
  retryTimes?: number;
  defaultCdns?: PropertyCdn[];
}

function viteAddCdnScript(opt: IOptions): PluginOption {
  const { protocol = "https", customScript = {}, retryTimes = 1, defaultCdns = ["jsdelivr", "unpkg"] } = opt;
  let _config;
  const _npmProObj = { ...customScript };

  return {
    name: "vite-add-cdn-script",
    enforce: EEnforce.PRE,
    apply: "build",
    config(confing) {
      _config = confing;
    },
    async transformIndexHtml(html) {
      if (!defaultCdns || defaultCdns.length === 0) throw new Error("defaultCdns不能为空");
      const packageJsonPath = path.resolve(process.cwd(), "package.json");
      try {
        const packageJson = fs.readFileSync(packageJsonPath, "utf-8");
        const packageData = JSON.parse(packageJson);
        const external = _config.build.rollupOptions.external;
        const packNameUrl: { [k in PropertyCdn]?: string[] } = {};
        let script = "";
        const urlListRes = await Promise.all(
          external.map(async (key) => {
            const version = getPackageVersion(packageData, key);
            if (customScript[key]) {
              return {
                urls: [],
                key,
              };
            }
            if (!version) {
              console.error(`package.json中不存在${key}的版本号`);
              return;
            }
            return {
              urls: await Promise.all(
                defaultCdns.map(async (cdn) => {
                  return await getPackageURL(key, version, cdn);
                }),
              ),
              key,
            };
          }),
        );
        urlListRes.forEach((element) => {
          if (!element) return;
          const { urls, key } = element;
          if (customScript[key]) {
            script += customScript[key];
          } else {
            packNameUrl[key] = urls;
            const url = urls[0];
            script += `<script src="${url}" type="text/javascript" crossorigin="anonymous" onerror="errorCDN(this)" data-cur="0"  data-key="${key}"></script>\n`;
          }
        });
        const errorScript = `<script>
        function errorCDN(e) {
          const packNameUrl = JSON.parse('${JSON.stringify(packNameUrl)}');
          const nextCur = parseInt(e.getAttribute("data-cur")) + 1;
          if(nextCur>${retryTimes}){return;}
          
          const key = e.getAttribute("data-key");
          if(nextCur>=packNameUrl[key].length){return;}
          // 新的cdn链接
          const url = packNameUrl[key][nextCur]
          // 克隆原标签
          const tagName = e.tagName
          const cdnDOM = document.createElement(tagName);
          cdnDOM.setAttribute(tagName === 'SCRIPT' ?'src' : 'href', url);
          Object.keys(e.dataset).forEach(_key => {
            cdnDOM.setAttribute('data-'+_key, e.dataset[_key]);
          })
          cdnDOM.setAttribute("data-cur", nextCur.toString());
          cdnDOM.setAttribute("onerror", "errorCDN(this)");
          document.head.appendChild(cdnDOM);
          e.remove();
        }
      </script>`;
        script = errorScript + script;
        html = html.replace("</head>", `${script}</head>`);

        return html;
      } catch (error) {
        console.error("获取dependencies出错:", error);
      }
    },
  };
}
export default viteAddCdnScript;
