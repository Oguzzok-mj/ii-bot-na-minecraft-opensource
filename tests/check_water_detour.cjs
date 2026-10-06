const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const target=new Vec3(6,4,0),dug=[]
const bot={game:{dimension:'overworld'},entity:{position:new Vec3(.5,12,.5),eyeHeight:1.62},registry:{blocksByName:{}},inventory:{emptySlotCount:()=>30},nearestEntity:()=>null,findBlocks:()=>[target],
 blockAt:p=>({position:p,name:p.equals(target)?'iron_ore':p.y===11?'water':'stone',boundingBox:p.y===11?'empty':'block',hardness:p.y===11?100:1.5}),
 canDigBlock:()=>true,canSeeBlock:()=>false,world:{raycast:()=>null},waitForTicks:async()=>{},pathfinder:{goto:async goal=>{bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5)}}}
const skills={limited:async p=>p,blocked:new Map(),key:p=>p.toString(),count:()=>0,ui:{},radar:{setTarget:()=>{}},solid:b=>b?.boundingBox==='block',hazardous:b=>/water|lava/.test(b?.name||''),dig:async b=>dug.push(b),goto:async()=>{}}
;(async()=>{
 await require(path.join(root,'iron-skills'))(bot,skills).handle({command:'mine_resource',resource:'iron'})
 assert.equal(bot.entity.position.y,13,'Climb to a safe bypass when every descending step enters the aquifer')
 assert(dug.every(b=>!/water|lava/.test(b.name)))
 console.log('PASS: synthetic aquifer stall escapes upward instead of repeating a flat step; liquids remain untouched')
})().catch(error=>{console.error(error);process.exitCode=1})
