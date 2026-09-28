/* 单文件 HTML 的语法冒烟：把 <script> 块抠出来交给 node --check。
   目的不是验证游戏逻辑（那是 qa_run.js 的活），而是在「刚手工改过几十行」之后，
   秒级确认没有语法错误 / 括号不配对 / 字符串没闭合 —— 这类错误会让整个脚本静默不执行，
   表现是页面白屏，而 qa_run.js 有时反而不报错，最难查。 */
var fs=require('fs'),vm=require('vm'),path=require('path');
var f=path.join(__dirname,'outputs','解压水消除.html');
var src=fs.readFileSync(f,'utf8');
var re=/<script[^>]*>([\s\S]*?)<\/script>/gi,m,blocks=[],i=0;
while((m=re.exec(src))){blocks.push({i:i++,head:m[0].slice(0,m[0].indexOf('>')+1),body:m[1],at:src.slice(0,m.index).split('\n').length});}
console.log('script 块数:',blocks.length);
var bad=0;
blocks.forEach(function(b){
  try{ new vm.Script(b.body,{filename:'block'+b.i+'.js'}); console.log('  块'+b.i+' 起始第'+b.at+'行  语法 OK  ('+b.body.length+' 字符)'); }
  catch(e){ bad++; console.log('  块'+b.i+' 起始第'+b.at+'行  ❌ 语法错误: '+e.message); }
});
/* 顺带查几个「改坏了才看得出」的结构性指标 */
var checks=[
  ['LV_PANEL 含环境切换字段',  /ew:\s*250/.test(src) && /ex1:\s*100/.test(src) && /ex2:\s*370/.test(src)],
  ['setEnvUI 已定义',          /function setEnvUI\(/.test(src)],
  ['setEnvUI 已被 lvPickTap 调用', /setEnvUI\('test'\)/.test(src) && /setEnvUI\('online'\)/.test(src)],
  ['画与点共用 LV_PANEL 坐标',  /P\.ex1,P\.ey,P\.ew,P\.eh/.test(src) && /vx>=P\.ex1&&vx<=P\.ex1\+P\.ew/.test(src)],
  ['面板高度已加高',            /ph:\s*900/.test(src)],
  ['关闭按钮已下移',            /cY:\s*1078/.test(src)]
];
console.log('\n结构性检查:');
checks.forEach(function(c){ console.log((c[1]?'  ✅ ':'  ❌ ')+c[0]); if(!c[1])bad++; });
console.log('\n'+(bad?'❌ 有 '+bad+' 项不通过':'✅ 语法与结构全部通过'));
process.exit(bad?1:0);
