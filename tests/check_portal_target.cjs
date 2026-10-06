const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
let present=true,walked=null
const target=new Vec3(60,70,45)
const bot={entity:{position:new Vec3(0,69,0)},game:{dimension:'overworld'},pathfinder:{goto:async goal=>{walked=goal;bot.entity.position=target}},
 findBlock:options=>present&&options.matching({name:'nether_portal',position:target})?{name:'nether_portal',position:target}:null}
const skills={limited:async p=>p,ui:{home:{x:0,y:69,z:0},portalOverrides:{overworld:{x:60,y:70,z:45}}}}
;(async()=>{
 const endgame=require(path.join(root,'endgame-skills'))(bot,skills)
 assert((await endgame.handle({command:'portal_status'})).lit)
 assert(walked&&walked.x===60&&walked.z===45,'Manual portal must guide navigation rather than search at home')
 present=false
 await assert.rejects(endgame.handle({command:'portal_status'}),/координатам/)
 console.log('PASS: configured portal navigation, actual portal check, no construction when configured portal is missing')
})().catch(error=>{console.error(error);process.exitCode=1})
