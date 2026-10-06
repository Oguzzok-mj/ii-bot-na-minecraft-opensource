const path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const position=new Vec3(0,20,0),chestPosition=new Vec3(1,20,0)
let carried=[{slot:9,name:'diamond',type:1,metadata:0,count:4,stackSize:64},{slot:10,name:'cobblestone',type:2,metadata:0,count:64,stackSize:64},{slot:11,name:'diamond_pickaxe',type:3,metadata:0,count:1,stackSize:1}]
let stored=[]
let full=false
const container={inventoryStart:27,slots:Array(63).fill(null),items:()=>carried,
  deposit:async(type,metadata,count)=>{const item=carried.find(i=>i.type===type);assert(item.count>=count);item.count-=count;stored.push({type,count});carried=carried.filter(i=>i.count)},close:()=>{}}
const bot={entity:{position},registry:{blocksByName:{}},players:{},inventory:{items:()=>carried},
  findBlocks:()=>[chestPosition],blockAt:p=>({name:'chest',position:p}),nearestEntity:()=>null,
  openContainer:async()=>container,supportFeature:()=>false,waitForTicks:async()=>{}}
const skills={limited:async p=>p,blocked:new Map(),key:p=>p.toString(),count:()=>0,dig:async()=>{},goto:async()=>{},solid:()=>true,hazardous:()=>false,ui:{},radar:{playerList:()=>[{name:'Human',position,live:true}],setTarget:()=>{}}}
;(async()=>{
 const delivery=require(path.join(root,'iron-skills'))(bot,skills)
 const result=await delivery.handle({command:'deliver_step'})
 assert(result.done);assert.equal(result.deposited,68);assert.equal(result.player,'Human')
 assert.equal(carried.length,1);assert.equal(carried[0].name,'diamond_pickaxe')
 carried.push({slot:12,name:'diamond',type:1,metadata:0,count:5,stackSize:64})
 container.slots.fill({type:99,count:64,stackSize:64})
 await assert.rejects(delivery.handle({command:'deliver_step'}),/заполнены/)
 assert.equal(carried.find(i=>i.name==='diamond').count,5)
 console.log('PASS: resource delivery, inferred human recipient, best tool retained, full chest preserves remaining items')
})().catch(e=>{console.error(e);process.exitCode=1})
