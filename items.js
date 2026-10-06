'use strict'
window.setupMineItems=viewer=>{
  const update=viewer.updateEntity.bind(viewer),items=new Map()
  viewer.updateEntity=entity=>{
    update(entity.itemName?{...entity,name:undefined}:entity)
    if(entity.delete){items.delete(entity.id);return}
    const mesh=viewer.entities.entities[entity.id]
    if(!entity.itemName||!mesh||items.has(entity.id)||!window.THREE)return
    items.set(entity.id,mesh)
    const T=window.THREE
    mesh.geometry.dispose();mesh.material.dispose()
    mesh.geometry=new T.PlaneGeometry(.35,.35)
    mesh.geometry.translate(0,.2,0)
    mesh.material=new T.MeshBasicMaterial({color:0xbddce3,side:T.DoubleSide,transparent:true,alphaTest:.1})
    new T.TextureLoader().load(`/api/item-texture/${encodeURIComponent(entity.itemName)}`,texture=>{
      if(viewer.entities.entities[entity.id]!==mesh){texture.dispose();return}
      texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter
      mesh.material.map=texture;mesh.material.color.setHex(0xffffff);mesh.material.needsUpdate=true
    },undefined,()=>{})
  }
  return ()=>{for(const [id,mesh] of items){if(viewer.entities.entities[id]!==mesh)items.delete(id);else mesh.quaternion.copy(viewer.camera.quaternion)}}
}
