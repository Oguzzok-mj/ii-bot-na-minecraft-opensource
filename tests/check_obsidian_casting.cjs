const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Chunk=require(path.join(root,'node_modules/prismarine-chunk'))('1.20.1')
const World=require(path.join(root,'node_modules/prismarine-world'))('1.20.1')
const world=new World(()=>new Chunk()).sync
const events=new (require('node:events').EventEmitter)()
for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)world.setColumn(x,z,new Chunk())
const set=(p,name)=>{const before=world.getBlock(p);world.setBlockStateId(p,registry.blocksByName[name].defaultState);events.emit('blockUpdate',before,world.getBlock(p))}
for(let x=-32;x<48;x++)for(let z=-32;z<48;z++)set(new Vec3(x,19,z),'stone')
const lava=new Vec3(12,20,0),water=new Vec3(8,20,0)
set(lava,'lava');set(water,'water')
let counts={diamond_pickaxe:1,bucket:0,water_bucket:1,lava_bucket:1,cobblestone:64,obsidian:0}
let target=null,liquidUses=0,throwOnHidden=false,liquidTransitions=[]
const directions=[new Vec3(0,-1,0),new Vec3(0,1,0),new Vec3(0,0,-1),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(1,0,0)]
const bot={registry,health:20,food:20,entities:{},game:{dimension:'overworld'},world,on:events.on.bind(events),
 entity:{position:new Vec3(2.5,20,2.5),eyeHeight:1.62,onGround:true},
 blockAt:p=>world.getBlock(p.floored()),inventory:{items:()=>Object.entries(counts).filter(([n,c])=>c).map(([name,count])=>({name,count}))},
 pathfinder:{setGoal(){},getPathTo:()=>({status:'success'}),goto:async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)}},
 findBlocks:options=>[lava,water].filter(p=>options.matching(bot.blockAt(p))),
 waitForTicks:async()=>{},lookAt:async p=>{target=p},clearControlStates(){},
 canDigBlock:()=>true,canSeeBlock:()=>true,
 placeBlock:async(b,face)=>{assert.equal(bot.heldItem.name,'cobblestone');counts.cobblestone--;set(b.position.plus(face),'cobblestone')},
 activateItem(){
  const eye=bot.entity.position.offset(0,1.62,0),direction=target.minus(eye).normalize(),name=bot.heldItem.name
  if(name==='bucket'){
   const hit=world.raycast(eye,direction,4.5,b=>['water','lava'].includes(b.name))
   assert(hit,'Empty bucket must hit a real fluid source')
   const fluid=hit.name;assert.equal(Number(hit.getProperties().level),0)
   counts.bucket--;counts[fluid+'_bucket']=(counts[fluid+'_bucket']||0)+1;set(hit.position,'air')
  }else{
   const hit=world.raycast(eye,direction,4.5);assert(hit,'Placement must hit an actual solid face')
   const destination=hit.position.plus(directions[hit.face])
   const center=skills.ui.obsidianFactory.center
   const expected=name==='lava_bucket'?new Vec3(center.x,center.y,center.z):new Vec3(center.x,center.y+1,center.z)
   assert(destination.equals(expected),`${name} would land at ${destination}, expected ${expected}`)
   assert(!destination.floored().equals(bot.entity.position.floored()),'Never place fluid at bot feet')
   counts[name]--;counts.bucket++;set(destination,name.split('_')[0]);liquidUses++
   liquidTransitions.push({item:name,position:destination})
   if(name==='water_bucket'){
    assert.equal(bot.blockAt(expected.offset(0,-1,0)).name,'lava')
    set(expected.offset(0,-1,0),'obsidian')
   }
  }
 }
}
const skills={ui:{},limited:async p=>p,count:n=>counts[n]||0,protectedBase:()=>false,
 equip:async name=>{assert(counts[name]>0,name);bot.heldItem={name}},
 craft:async()=>{throw new Error('Unexpected craft')},
 remember:(names,p)=>{skills.ui.pendingLoot={wanted:names,position:p}},
 dig:async b=>{assert(!/lava|water/.test(b.name));set(b.position,'air')},
 pickup:async()=>{assert(!skills.ui.pendingLoot||bot.blockAt(skills.ui.pendingLoot.position).name==='air');counts.obsidian++;skills.ui.pendingLoot=null}
}
;(async()=>{
 const casting=require(path.join(root,'obsidian-casting'))(bot,skills)
 assert(casting.offer(),'Filled buckets must permit creation')
 bot.game.dimension='the_nether';assert.equal(casting.offer(),null)
 await assert.rejects(casting.step(),/обычном мире/)
 bot.game.dimension='overworld'
 counts.lava_bucket=0;counts.bucket=1
 set(lava,'lava');set(lava, 'lava')
 const flowingId=registry.blocksByName.lava.minStateId+1
 world.setBlockStateId(lava,flowingId)
 assert(!casting.source(bot.blockAt(lava),'lava'),'Flowing lava must never qualify')
 assert.equal(casting.offer(),null)
 set(lava,'lava');assert(casting.offer(),'Safe accessible source must qualify')
 counts.lava_bucket=1;counts.bucket=0
 casting.select()
 let steps=0
 while(skills.ui.obsidianFactory.phase!=='open_exit'&&steps++<55)await casting.step()
 assert.equal(skills.ui.obsidianFactory.created,0,'Mining without pickup must not count as collected')
 await casting.prepareCollection()
 assert.equal(skills.ui.obsidianFactory.phase,'collect','A scheduled deposit must open the exit before external loot collection')
 await skills.pickup(['obsidian']);casting.confirmCollection()
 assert.equal(skills.ui.obsidianFactory.created,1)
 assert.equal(counts.obsidian,1)
 assert.equal(counts.water_bucket,1,'Water must be recovered for reuse')
 assert.equal(counts.lava_bucket,0,'One lava source is consumed per obsidian')
 assert.equal(liquidUses,2)
 assert.equal(skills.ui.obsidianFactory.phase,'lava')
 const center=skills.ui.obsidianFactory.center,p=new Vec3(center.x,center.y,center.z)
 assert.equal(bot.blockAt(p.offset(1,1,0)).name,'air','Open an exit before asking loot pathfinder to enter the mold')
 const created=skills.ui.obsidianFactory.created
 counts.lava_bucket=1;counts.bucket=0
 while(skills.ui.obsidianFactory.created===created&&steps++<95)await casting.step()
 assert.equal(counts.obsidian,2,'Reuse and repair the existing mold for the next source')
 skills.ui.obsidianFactory.phase='cast_lava'
 set(p.offset(-1,1,0),'air')
 const before=liquidUses
 await assert.rejects(casting.step(),/Форма/)
 assert.equal(liquidUses,before,'A broken wall must prevent any liquid placement')
 skills.ui.obsidianFactory.phase='prepare';bot.health=8
 await assert.rejects(casting.step(),/здоровье/)
 assert.equal(liquidUses,before)
 console.log('PASS: real 1.20.1 block/raycast geometry, exact bucket placement, source-only lava, closed mold, water recovery, confirmed loot, reusable mold, exit, health and wall guards')
})().catch(error=>{console.error(error);process.exitCode=1})
