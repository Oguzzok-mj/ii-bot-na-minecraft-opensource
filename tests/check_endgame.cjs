const assert=require('node:assert/strict'),path=require('node:path')
const root=path.resolve(__dirname,'..')
const registry=require(path.join(root,'node_modules/prismarine-registry'))('1.20.1')
const Item=require(path.join(root,'node_modules/prismarine-item'))(registry)
const {Vec3}=require(path.join(root,'node_modules/vec3'))
const left=new Item(registry.itemsByName.diamond_pickaxe.id,1),right=new Item(registry.itemsByName.diamond_pickaxe.id,1)
left.slot=9;right.slot=10
left.enchants=[{name:'efficiency',lvl:4},{name:'unbreaking',lvl:3}]
right.enchants=[{name:'efficiency',lvl:4},{name:'fortune',lvl:3},{name:'unbreaking',lvl:3}]
let items=[left,right],mutations=0
const position=new Vec3(-16,69,-29)
const bot={registry,experience:{level:30},entity:{position},game:{dimension:'overworld'},inventory:{items:()=>items,slots:Array(46).fill(null)},findBlock:()=>({name:'anvil',position}),blockAt:p=>({name:p.y===68?'stone':'air',position:p,boundingBox:p.y===68?'block':'empty'}),pathfinder:{goto:async()=>{}},openAnvil:async()=>({close(){},async combine(a,b){mutations++;const result=Item.anvil(a,b,false);items=[result.item];bot.experience.level-=result.xpCost}})}
const skills={limited:async p=>p,count:name=>items.filter(i=>i.name===name).reduce((n,i)=>n+i.count,0),goto:async()=>{},equip:async()=>{},ui:{home:{x:-16,y:69,z:-29}}}
;(async()=>{
  const module=require(path.join(root,'endgame-skills'))(bot,skills)
  const result=await module.handle({command:'combine_pickaxes'})
  assert.equal(result.complete,true)
  assert.equal(result.enchants.find(e=>e.name==='efficiency').lvl,5)
  assert.equal(result.enchants.find(e=>e.name==='fortune').lvl,3)
  assert.equal(result.enchants.find(e=>e.name==='unbreaking').lvl,3)
  assert.equal(mutations,1)
  bot.experience.level=0
  await assert.rejects(module.handle({command:'enchant_pickaxe'}),/30/)
  await assert.rejects(module.handle({command:'smith_upgrade',item:'diamond_pickaxe'}),/шаблон/)
  bot.findBlock=()=>null
  await assert.rejects(module.handle({command:'build_portal'}),/14/)
  assert.equal(mutations,1)
  console.log('PASS: real 1.20.1 enchantment merge IV + IV → V, Fortune III, Unbreaking III; missing XP/template/obsidian cause no mutation')
})().catch(error=>{console.error(error);process.exitCode=1})
