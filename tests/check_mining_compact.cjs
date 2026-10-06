const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const items=[{name:'cobbled_deepslate',type:1,metadata:0,count:64},{name:'cobbled_deepslate',type:1,metadata:0,count:64},{name:'dirt',type:2,metadata:0,count:40},{name:'granite',type:3,metadata:0,count:64},{name:'diamond',type:4,count:12},{name:'netherite_pickaxe',type:5,count:1,enchants:[{name:'fortune',lvl:3}]},{name:'cooked_beef',type:6,count:16}]
const bot={game:{dimension:'overworld'},entity:{position:new Vec3(0,20,0)},inventory:{items:()=>items},toss:async(type,metadata,count)=>{for(const i of items.filter(i=>i.type===type)){const taken=Math.min(count,i.count);i.count-=taken;count-=taken;if(!count)break}assert.equal(count,0)}}
const skills={limited:async p=>p,blocked:new Map(),ui:{},radar:{},count:()=>0}
;(async()=>{
 const miner=require(path.join(root,'iron-skills'))(bot,skills),result=await miner.handle({command:'mining_compact'})
 assert.equal(result.released,136)
 assert.equal(items.filter(i=>i.name==='cobbled_deepslate').reduce((n,i)=>n+i.count,0),64)
 assert.equal(items.find(i=>i.name==='dirt').count,32)
 assert.equal(items.find(i=>i.name==='diamond').count,12)
 assert.equal(items.find(i=>i.name==='netherite_pickaxe').count,1)
 assert.equal(items.find(i=>i.name==='cooked_beef').count,16)
 console.log('PASS: compact terrain, retain building reserves, preserve diamonds, enchanted equipment and food')
})().catch(error=>{console.error(error);process.exitCode=1})
