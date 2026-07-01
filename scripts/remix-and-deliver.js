#!/usr/bin/env node
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const LANG = process.env.DIGEST_LANG || 'zh';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
function log(...a){ console.error('[digest]', ...a); }
async function main(){
  const raw = execFileSync('node', [path.join(__dirname,'prepare-digest.js')], { maxBuffer: 64*1024*1024 }).toString();
  const data = JSON.parse(raw);
  const stats = data.stats || {};
  log('stats', stats);
  if ((stats.xBuilders||0)===0 && (stats.podcastEpisodes||0)===0){ await deliver('今天没有新的 builder 动态，明天见。'); return; }
  const prompts = data.prompts || {};
  const xBlocks = (data.x||[]).map(b=>{
    const tw=(b.tweets||[]).map(t=>`- ${(t.text||'').replace(/\s+/g,' ').trim()}\n  ${t.url}`).join('\n');
    return `### ${b.name}\nbio: ${b.bio||''}\n${tw}`;
  }).join('\n\n');
  const sys=[prompts.digest_intro||'', '\n---\nTWEET SUMMARY RULES:\n', prompts.summarize_tweets||'',
    LANG==='zh'?('\n---\n用中文输出整份摘要。翻译规则：\n'+(prompts.translate||'')):'',
    '\n---\n硬规则：只用下面 JSON 里的内容，绝不联网、不编造；每条必须带原推 x.com 链接；跳过闲聊/活动帖。'].join('\n');
  const user=`今天的 X 建造者原始推文如下，请重混成${LANG==='zh'?'中文':LANG==='bilingual'?'中英双语':'英文'}摘要（每人 1–2 句、保留链接）：\n\n${xBlocks}`;
  const digest = await remix(sys, user);
  await deliver(digest); log('delivered.');
}
async function remix(system,userText){
  const key=process.env.ANTHROPIC_API_KEY; if(!key) throw new Error('缺 ANTHROPIC_API_KEY');
  const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
    headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},
    body:JSON.stringify({model:MODEL,max_tokens:4000,system,messages:[{role:'user',content:userText}]})});
  if(!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const j=await res.json(); return (j.content||[]).map(c=>c.text||'').join('').trim();
}
async function deliver(text){
  const tgToken=process.env.TELEGRAM_BOT_TOKEN, tgChat=process.env.TELEGRAM_CHAT_ID;
  if(tgToken&&tgChat){ for(const c of splitText(text,4000)){ const r=await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:tgChat,text:c,disable_web_page_preview:true})}); if(!r.ok) throw new Error(`Telegram ${r.status}: ${await r.text()}`);} return; }
  const hook=process.env.FEISHU_WEBHOOK; if(!hook) throw new Error('缺 FEISHU_WEBHOOK');
  for(const c of splitText(text,9000)){ const r=await fetch(hook,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({msg_type:'text',content:{text:c}})}); const jt=await r.text(); if(!r.ok||/"code":[1-9]/.test(jt)) throw new Error(`Feishu webhook 失败: ${jt}`);}
}
function splitText(s,max){ const out=[]; let cur=''; for(const line of s.split('\n')){ if((cur+line+'\n').length>max){ if(cur) out.push(cur); cur='';} cur+=line+'\n';} if(cur.trim()) out.push(cur); return out.length?out:[s]; }
main().catch(e=>{ console.error(e); process.exit(1); });
