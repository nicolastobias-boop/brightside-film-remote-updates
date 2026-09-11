const assert=require('node:assert/strict');
const {splitManuscript,analyzeProject,fingerprint}=require('../src/project-analysis');
(async()=>{
 const source='a'.repeat(51000)+'SLUT'; const chunks=splitManuscript(source);
 assert.equal(chunks[0].start,0);assert.equal(chunks.at(-1).end,source.length);
 for(let i=1;i<chunks.length;i++)assert(chunks[i].start<chunks[i-1].end);
 const inputs=[];let partners=0;
 const result=await analyzeProject({text:source,bible:'LÅSTE REGLER',ask:async(p)=>{inputs.push(p);return 'Karakter Mikkel; belæg scene 1';},partner:async()=>{partners++;return 'Kontrol';}});
 assert.equal(partners,chunks.length);assert.equal(inputs.length,chunks.length+1);
 assert(inputs.at(-1).includes('LÅSTE REGLER'));assert(inputs.at(-1).includes('Claude-kontrol'));
 assert(inputs[chunks.length-1].includes('SLUT'));assert.equal(result.sourceHash,fingerprint(source));
 await assert.rejects(analyzeProject({text:' ',ask:async()=>''}),/Gem et manus/);
 await assert.rejects(analyzeProject({text:'test',ask:async()=>{throw Error('failure')},partner:async()=> 'ok'}),/failure/);
 console.log('PASS: whole manuscript coverage, paired analysis, synthesis, source fingerprint, empty input and API failure');
})();
