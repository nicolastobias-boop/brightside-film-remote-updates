function parseScenes(text){
 const lines=text.split(/\r?\n/),out=[];let offset=0;
 for(let i=0;i<lines.length;i++){
 const line=lines[i].trim();
 if(/^(?:\d+[A-Z]?\s+)?(?:INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|INT\.|EXT\.|I\/E\.)\s/i.test(line)){
 let number=line.match(/^(\d+[A-Z]?)\s/i)?.[1]||line.match(/\s(\d+[A-Z]?)\s*$/i)?.[1]||'';
 let inferred=false;
 if(!number){const next=(lines[i+1]||'').trim();if(/^\d+[A-Z]?$/i.test(next)){number=next;if(/^\d+$/.test(next)&&next.length%2===0&&next.slice(0,next.length/2)===next.slice(next.length/2)){number=next.slice(0,next.length/2);inferred=true;}}}
 out.push({id:String(offset),number,heading:line,inferred,start:offset});
 }
 offset+=lines[i].length+1;
 }
 return out.map((s,i)=>({...s,text:lines.join('\n').slice(s.start,out[i+1]?.start).trim()}));
}
module.exports={parseScenes};
const words=s=>(s.toLowerCase().match(/[\p{L}\d]+/gu)||[]);
const ignored=new Set('og i på hos med en et den det de der til fra om som hvor scene scener mødes møder er så jeg du han hun hans hendes kan skal vil'.split(' '));
function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}
function searchScenes(text,query){
 const scenes=parseScenes(text),q=query.trim().toLowerCase();
 if(/^\d+[a-z]?$/i.test(q))return scenes.filter(s=>s.number.toLowerCase()===q);
 const terms=[...new Set(words(q).filter(w=>w.length>2&&!ignored.has(w)))];if(!terms.length)return [];
 return scenes.map(scene=>{
 const tokens=[...new Set(words(scene.text))],heading=new Set(words(scene.heading));let score=0;const matches=[];let first=-1;
 for(const term of terms){let best='',value=0;for(const token of tokens){const v=term===token?1:term.length>=4&&token.length>=4&&Math.abs(term.length-token.length)<=3&&(token.startsWith(term)||term.startsWith(token))?.85:term.length>=5&&token.length>=5&&term.slice(0,5)===token.slice(0,5)?.6:term.length>=4&&Math.abs(term.length-token.length)<=2&&distance(term,token)<=(term.length>=7?2:1)?.65:0;if(v>value){value=v;best=token;}}
 if(value){score+=value*(heading.has(best)?1.4:1);matches.push(best);const position=scene.text.toLowerCase().indexOf(best);if(first<0)first=position;}}
 return {...scene,score,matches:[...new Set(matches)],preview:scene.text.slice(Math.max(0,first-90),Math.max(0,first-90)+450)};
 }).filter(s=>s.matches.length>=Math.min(2,terms.length)).sort((a,b)=>b.score-a.score).slice(0,12);
}
module.exports.searchScenes=searchScenes;
