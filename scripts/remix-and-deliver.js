#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LANG = process.env.DIGEST_LANG || 'zh';
function log(...a){ console.error('[digest]', ...a); }
async function main(){
  const raw = execFileSync('node', [path.join(__dirname,'prepare-digest.js')], { maxBuffer: 64*1024*1024 }).toString();
  const data = JSON.parse(raw);
  const stats = data.stats || {};
  log('stats', stats);
  if ((stats.xBuilders||0)===0 && (stats.podcastEpisodes||0)===0){ await deliver('【AI摘要】今天没有新的 builder 动态，明天见。'); return; }
  const prompts = data.prompts || {};
  const xBlocks = (data.x||[]).map(b=>{
    const tw=(b.tweets||[]).map(t=>`- ${(t.text||'').replace(/\s+/g,' ').trim()}\n  ${t.url}`).join('\n');
    return `### ${b.name}\nbio: ${b.bio||''}\n${tw}`;
  }).join('\n\n');
  const langWord = LANG==='zh'?'中文':LANG==='bilingual'?'中英双语':'英文';
  const fullPrompt = [prompts.digest_intro||'', '\n--- 推文摘要规则 ---\n', prompts.summarize_tweets||'',
    LANG==='zh'?('\n--- 翻译规则 ---\n用中文输出整份摘要。\n'+(prompts.translate||'')):'',
    '\n--- 硬规则 ---','只用下面给的内容，绝不联网、不访问任何 URL、不编造；每条必须带原推 x.com 链接；跳过闲聊/活动/无实质帖。',
    `请把下面的 X 建造者原始推文重混成${langWord}摘要（每人 1–2 句、保留链接）。直接输出成品，开头一行标题「📅 AI Builders 每日摘要」，不要任何前后缀、不要问我问题。`,
    '\n=== 原始推文 ===\n', xBlocks].join('\n');
  let digest = remixWithClaude(fullPrompt);
  digest = digest.split('\n').filter(l => !/follow[- ]?builders|zarazhangrui|zara\s*zhang|Generated through|Follow Builders skill/i.test(l)).join('\n').replace(/\n{3,}/g,'\n\n').trim();
  await deliver(digest || '【AI摘要】生成为空。'); log('delivered.');
}
function remixWithClaude(prompt){
  const env = { ...process.env };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_CODE_OAUTH_TOKEN.replace(/\s/g,'');
  return execFileSync('claude', ['-p','--output-format','text'], { input: prompt, maxBuffer: 64*1024*1024, env }).toString().trim();
}
async function deliver(text){
  const tgToken=process.env.TELEGRAM_BOT_TOKEN, tgChat=process.env.TELEGRAM_CHAT_ID;
  if(tgToken&&tgChat){ for(const c of splitText(text,4000)){ const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:tgChat,text:c,disable_web_page_preview:true})}); if(!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);} return; }
  const appId=process.env.FEISHU_APP_ID, appSecret=process.env.FEISHU_APP_SECRET;
  if(appId&&appSecret){ await deliverFeishuApp(text, appId, appSecret); return; }
  const hook=process.env.FEISHU_WEBHOOK; if(!hook) throw new Error('缺投递配置：FEISHU_APP_ID/FEISHU_APP_SECRET 或 FEISHU_WEBHOOK');
  for(const c of splitText(text,9000)){ const r=await fetch(hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({msg_type:'text',content:{text:c}})}); const jt=await r.text(); if(!r.ok||/"code":[1-9]/.test(jt)) throw new Error(`Feishu webhook 失败: ${jt}`);}
}
async function deliverFeishuApp(text, appId, appSecret){
  const base = process.env.FEISHU_DOMAIN || 'https://open.feishu.cn';
  const tr = await fetch(`${base}/open-apis/auth/v3/tenant_access_token/internal`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({app_id:appId, app_secret:appSecret}) });
  const tj = await tr.json();
  if(tj.code!==0) throw new Error(`拿 tenant_access_token 失败: ${JSON.stringify(tj)}`);
  const token = tj.tenant_access_token;
  const idType = process.env.FEISHU_RECEIVE_ID_TYPE || 'chat_id';
  const receiveId = process.env.FEISHU_RECEIVE_ID; if(!receiveId) throw new Error('缺 FEISHU_RECEIVE_ID');
  for(const c of splitText(text,9000)){
    const r = await fetch(`${base}/open-apis/im/v1/messages?receive_id_type=${idType}`, { method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${token}`}, body:JSON.stringify({receive_id:receiveId, msg_type:'text', content:JSON.stringify({text:c})}) });
    const rj = await r.json();
    if(rj.code!==0) throw new Error(`飞书发送失败: ${JSON.stringify(rj)}`);
  }
}
function splitText(s,max){ const out=[]; let cur=''; for(const line of s.split('\n')){ if((cur+line+'\n').length>max){ if(cur) out.push(cur); cur='';} cur+=line+'\n';} if(cur.trim()) out.push(cur); return out.length?out:[s]; }
main().catch(e=>{ console.error(e); process.exit(1); });
