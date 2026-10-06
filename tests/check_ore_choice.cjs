const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const root=path.resolve(__dirname,'..'),{Vec3}=require(path.join(root,'node_modules/vec3'))
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ore-choice-'))
const near=new Vec3(2,20,0),vein=[]
for(let x=6;x<8;x++)for(let z=0;z<3;z++)vein.push(new Vec3(x,20,z))
let mined=false,lava=false
const bot={entity:{position:new Vec3(.5,20,.5)},game:{dimension:'overworld'},findBlocks:()=>[near,...vein],
 blockAt:p=>({position:p,name:lava&&p.equals(near.offset(1,0,0))?'lava':p.equals(near)||vein.some(v=>v.equals(p))&&!mined?'diamond_ore':p.y<20?'stone':'air',boundingBox:p.y<20||p.equals(near)||vein.some(v=>v.equals(p))&&!mined?'block':'empty',hardness:3}),digTime:()=>500}
const skills={ui:{},policyDirectory:directory,radar:{},blocked:new Map(),protectedBase:()=>false}
const policy=require(path.join(root,'ore-policy'))(bot,skills)
try{
 const chosen=policy.select(['diamond_ore'])
 assert(chosen.blocks.length===6,'Prefer productive vein over isolated nearest block')
 mined=true
 assert.equal(policy.describe(vein,['diamond_ore']).length,0,'Mined blocks must leave the vein queue')
 lava=true
 assert.equal(policy.select(['diamond_ore']),undefined,'Never rank lava-adjacent targets')
 console.log('PASS: whole-vein ranking, mined-block invalidation, lava exclusion')
}finally{fs.rmSync(directory,{recursive:true,force:true})}
