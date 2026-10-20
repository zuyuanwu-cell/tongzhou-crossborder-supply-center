/**
 * 接入正式环境时：
 * 1. 将 demoMode 改为 false；
 * 2. 填写已在微信公众平台配置为 request 合法域名的 HTTPS 地址；
 * 3. 后端继续沿用 /collaboration 路由，不要在此保存任何密钥。
 */
module.exports = Object.freeze({
  demoMode: false,
  apiBaseUrl: "https://partner.tongzhoukuajing.com",
  adminApiBaseUrl: "https://gyl.tongzhoukuajing.com",
  cloudEnvId: "",
  requestTimeout: 15000,
});
