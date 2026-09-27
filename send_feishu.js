/**
 * 往飞书群机器人发消息（群自定义机器人 webhook，单向：只能发不能收）
 *
 * 用法：
 *   FEISHU_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/xxx" \
 *   node send_feishu.js <消息文件.md> [要@的 user_id，多个用逗号分隔]
 *
 * 说明：
 *   - msg_type 用 text，飞书群机器人单条文本有长度上限（约 30K 字符），超了会被拒。
 *   - @某人：飞书 webhook 的 text 类型里用 <at user_id="ou_xxx"></at>，
 *     部分版本需要配合 at 的 mentions。若 @ 不生效，改用 interactive 卡片或 @all。
 *   - 不传 user_id 时，默认不 @任何人，只发纯文本。
 *   - 退出码 0 = 成功；非 0 = 失败，错误信息会打印出来。
 */
const fs = require('fs');
const https = require('https');

const webhook = process.env.FEISHU_WEBHOOK;
const file = process.argv[2];
const atUsers = (process.argv[3] || '').split(',').map(s => s.trim()).filter(Boolean);

if (!webhook) { console.error('缺少 FEISHU_WEBHOOK 环境变量'); process.exit(1); }
if (!file || !fs.existsSync(file)) { console.error('消息文件不存在: ' + file); process.exit(1); }

let content = fs.readFileSync(file, 'utf8');

// 需要 @ 的人拼到正文末尾（飞书 text 类型对 <at> 的支持依赖版本，失败时改为手动 @）
if (atUsers.length) {
  const atTags = atUsers.map(u => `<at user_id="${u}"></at>`).join(' ');
  content = atTags + '\n' + content;
}

const body = JSON.stringify({
  msg_type: 'text',
  content: { text: content }
});

const url = new URL(webhook);
const req = https.request({
  hostname: url.hostname,
  path: url.pathname + url.search,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => {
    console.log('HTTP ' + res.statusCode);
    console.log(data);
    try {
      const j = JSON.parse(data);
      // 飞书成功返回 {"code":0,"msg":"success"} 或 StatusMessage 形态
      if (j.code === 0 || j.StatusCode === 0 || res.statusCode === 200 && !j.code) {
        console.log('SEND OK');
        process.exit(0);
      } else {
        console.log('SEND FAIL: ' + (j.msg || j.StatusMessage || JSON.stringify(j)));
        process.exit(2);
      }
    } catch (e) {
      console.log('无法解析返回，按失败处理: ' + data);
      process.exit(3);
    }
  });
});

req.on('error', e => { console.error('请求失败: ' + e.message); process.exit(4); });
req.write(body);
req.end();
