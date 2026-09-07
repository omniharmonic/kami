"use client";

import { useEffect, useId, useRef, useState } from "react";
import type * as THREE from "three";
import { Sprite } from "./Sprite";
import { validTerrain, terrainHeight, type TerrainGrid } from "./terrain";
import styles from "./world.module.css";

export type WorldBeing = {
  id: string;
  name: string;
  kind: string;
  x?: number;
  y?: number;
  status?: string;
  /** Public map placement only, never passed into agent prompts. */
  longitude?: number;
  latitude?: number;
};
export type LandscapeProps = {
  beings: WorldBeing[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  zoom?: number;
  habitat?: boolean;
  className?: string;
};

function positionFor(being: WorldBeing, index: number): [number, number] {
  if (Number.isFinite(being.longitude) && Number.isFinite(being.latitude) && being.longitude! >= -105.8 && being.longitude! <= -104.95 && being.latitude! >= 39.65 && being.latitude! <= 40.35) {
    return [((being.longitude! + 105.8) / .85 - .5) * 150, ((40.35 - being.latitude!) / .7 - .5) * 162];
  }
  const placements = [
    [5, 6],
    [-9, -5],
    [20, -8],
    [2, -22],
    [26, 10],
    [-18, 10],
  ];
  return being.x !== undefined && being.y !== undefined
    ? [(being.x - 0.5) * 54, (being.y - 0.5) * 40]
    : (placements[index % placements.length] as [number, number]);
}

export function Landscape({
  beings,
  selected = null,
  onSelect,
  zoom = 1,
  habitat = false,
  className = "",
}: LandscapeProps) {
  const skyId = useId().replace(/:/g, "");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRefs = useRef(new Map<string, HTMLButtonElement>());
  const current = useRef({ beings, selected, zoom, habitat });
  current.current = { beings, selected, zoom, habitat };
  const [ready, setReady] = useState(false);
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    let cleanup = () => {};
    void Promise.all([import("three"), fetch("/world/front-range-dem.json").then(r => r.ok ? r.json() : null).catch(() => null)])
      .then(([T, rawGrid]) => {
        if (destroyed) return;
        const grid: TerrainGrid | null = validTerrain(rawGrid) ? rawGrid : null;
        const heightAt = (x:number,z:number) => grid ? terrainHeight(grid,x,z) : 1.5 + Math.sin(x*.07)*Math.cos(z*.08);
        setMeasured(Boolean(grid));
        let renderer: THREE.WebGLRenderer;
        try {
          renderer = new T.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
            powerPreference: "low-power",
          });
        } catch {
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
        renderer.outputColorSpace = T.SRGBColorSpace;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        const scene = new T.Scene();
        scene.background = new T.Color("#cbe9df");
        scene.fog = new T.FogExp2("#cbe9df", 0.0035);
        const camera = new T.PerspectiveCamera(43, 1, 0.1, 260);
        camera.position.set(15, 31, 49);
        const look = new T.Vector3(0, 2, -8);
        const sun = new T.DirectionalLight("#fff0cf", 2.0);
        sun.position.set(-28, 38, 12);
        scene.add(sun, new T.HemisphereLight("#e7f1de", "#375d48", 1.4));
        const terrain = new T.PlaneGeometry(150, 162, 192, 192);
        terrain.rotateX(-Math.PI / 2);
        const pos = terrain.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        const low = new T.Color("#83b99a"),
          high = new T.Color("#a6b9ab"),
          snow = new T.Color("#fff6ed");
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i),
            z = pos.getZ(i),
            h = heightAt(x, z);
          pos.setY(i, h);
          const color = low.clone().lerp(high, Math.min(1, h / 17));
          if (h > 14) color.lerp(snow, Math.min(1, (h - 14) / 4));
          const texture =
            0.93 + 0.07 * Math.sin(x * 2.4 + z * 4.1) * Math.sin(z * 1.1);
          color.multiplyScalar(texture);
          color.toArray(colors, i * 3);
        }
        terrain.setAttribute("color", new T.BufferAttribute(colors, 3));
        terrain.computeVertexNormals();
        scene.add(
          new T.Mesh(
            terrain,
            new T.MeshStandardMaterial({
              vertexColors: true,
              roughness: 1,
              flatShading: true,
            }),
          ),
        );
        // Deterministic groves: shared instanced geometry keeps the miniature world light.
        let seed = 37;
        const random = () => {
          seed = (seed * 16807) % 2147483647;
          return (seed - 1) / 2147483646;
        };
        const treeCount = 1150;
        const crown = new T.InstancedMesh(
          new T.IcosahedronGeometry(0.9, 1),
          new T.MeshStandardMaterial({
            color: "#a2c9a1",
            roughness: 1,
            flatShading: true,
          }),
          treeCount,
        );
        const lower = new T.InstancedMesh(
          new T.ConeGeometry(1, 2.8, 9),
          new T.MeshStandardMaterial({
            color: "#649f86",
            roughness: 1,
            flatShading: true,
          }),
          treeCount,
        );
        const trunk = new T.InstancedMesh(
          new T.CylinderGeometry(0.1, 0.14, 1.1, 5),
          new T.MeshStandardMaterial({ color: "#7d7960", roughness: 1 }),
          treeCount,
        );
        const dummy = new T.Object3D();
        for (let i = 0; i < treeCount; i++) {
          let x = 0,
            z = 0;
          for (let attempt = 0; attempt < 20; attempt++) {
            x = (random() - 0.5) * 105;
            z = (random() - 0.5) * 77;
            if (heightAt(x, z) > 2 && heightAt(x, z) < 10) break;
          }
          const nearHome = current.current.beings.some((being, index) => {
            const [hx, hz] = positionFor(being, index);
            return Math.hypot(x - hx, z - hz) < 12;
          });
          const size = nearHome ? 0 : 0.45 + random() * 0.75,
            y = heightAt(x, z);
          dummy.rotation.set(0, random() * Math.PI, 0);
          dummy.scale.setScalar(size);
          dummy.position.set(x, y + size * 0.55, z);
          dummy.updateMatrix();
          trunk.setMatrixAt(i, dummy.matrix);
          dummy.position.y = y + size * 1.7;
          dummy.updateMatrix();
          lower.setMatrixAt(i, dummy.matrix);
          dummy.position.y = y + size * 2.7;
          dummy.updateMatrix();
          crown.setMatrixAt(i, dummy.matrix);
          const tint = new T.Color().setHSL(
            0.27 + random() * 0.065,
            0.19 + random() * 0.13,
            0.45 + random() * 0.17,
          );
          crown.setColorAt(i, tint);
        }
        scene.add(crown, lower, trunk);
        const rock = new T.InstancedMesh(
          new T.IcosahedronGeometry(1, 0),
          new T.MeshStandardMaterial({
            color: "#a6b3a0",
            flatShading: true,
            roughness: 1,
          }),
          160,
        );
        for (let i = 0; i < 160; i++) {
          const z = random() * 70 - 30,
            x = (random() - .5) * 95;
          dummy.position.set(x, heightAt(x, z), z);
          dummy.scale.set(
            0.25 + random() * 0.7,
            0.2 + random() * 0.5,
            0.3 + random() * 0.7,
          );
          dummy.rotation.set(random(), random() * 5, random());
          dummy.updateMatrix();
          rock.setMatrixAt(i, dummy.matrix);
        }
        scene.add(rock);
        const cloudMaterial = new T.MeshStandardMaterial({
          color: "#f2f3dc",
          transparent: true,
          opacity: 0.44,
          roughness: 1,
          depthWrite: false,
        });
        const cloudGeo = new T.SphereGeometry(1, 12, 8);
        for (let i = 0; i < 12; i++) {
          const cloud = new T.Mesh(cloudGeo, cloudMaterial);
          cloud.position.set(
            (random() - 0.5) * 120,
            16 + random() * 8,
            -48 - random() * 15,
          );
          cloud.scale.set(4 + random() * 7, 1.5 + random() * 2, 2 + random() * 3);
          scene.add(cloud);
        }
        const motesGeo = new T.BufferGeometry();
        const motes = new Float32Array(90 * 3);
        for (let i = 0; i < 90; i++) {
          const x = (random() - 0.5) * 65,
            z = (random() - 0.5) * 40;
          motes[i * 3] = x;
          motes[i * 3 + 1] = heightAt(x, z) + 2 + random() * 5;
          motes[i * 3 + 2] = z;
        }
        motesGeo.setAttribute("position", new T.BufferAttribute(motes, 3));
        const sparks = new T.Points(
          motesGeo,
          new T.PointsMaterial({
            color: "#fff6bd",
            size: 0.1,
            transparent: true,
            opacity: 0.8,
          }),
        );
        scene.add(sparks);
        // A small sculpted home appears when visiting. These are artistic habitat
        // details, not mapped vegetation or a claim about present streamflow.
        const home = new T.Group();
        const mat = (color:string) => new T.MeshStandardMaterial({color,roughness:.85});
        const moss=mat("#a9cba2"), petal=mat("#efb6c9"), cream=mat("#fff5dc");
        const lagoon=mat("#81d6ce");
        const add=(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx=1,sy=1,sz=1)=>{
          const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);home.add(mesh);return mesh;
        };
        add(new T.SphereGeometry(1,40,20),moss,0,-.65,0,7.7,.8,5.7);
        const pond=add(new T.CircleGeometry(3.8,64),lagoon,-1,.07,1,1,.7,1);
        pond.rotation.x=-Math.PI/2;
        const pebbleGeo=new T.IcosahedronGeometry(1,1);
        for(let i=0;i<38;i++){
          const a=i/38*Math.PI*2; const r=4.1+random()*.5;
          add(pebbleGeo,cream,Math.cos(a)*r,.12,Math.sin(a)*r*.72,.25+random()*.28,.18+random()*.25,.3);
        }
        const stemGeo=new T.CylinderGeometry(.025,.035,.45,5), flowerGeo=new T.SphereGeometry(.13,8,6);
        for(let i=0;i<45;i++){
          const a=random()*Math.PI*2,r=4.8+random()*1.8;
          const x=Math.cos(a)*r,z=Math.sin(a)*r*.75;
          add(stemGeo,moss,x,.3,z);
          add(flowerGeo,i%3?petal:cream,x,.57,z,1.3,.7,1.3);
        }
        // The sprite is a real three-dimensional character, with a seed crown,
        // petal ears, tiny limbs and a little field satchel.
        const creature=new T.Group();home.add(creature);
        const skin=mat("#c5eee0"), dark=mat("#315e58"), blush=mat("#edb0c0");
        const part=(geo:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number,sx=1,sy=1,sz=1)=>{
          const mesh=new T.Mesh(geo,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);creature.add(mesh);return mesh;
        };
        const sphere=new T.SphereGeometry(1,28,20);
        part(sphere,skin,0,1.1,0,1.1,1.25,.85);
        part(sphere,cream,0,.9,.66,.7,.64,.22);
        for(const side of [-1,1]){
          part(sphere,skin,side*.62,.04,.18,.35,.24,.43);
          const ear=part(sphere,skin,side*1.04,1.7,-.05,.22,.67,.18);ear.rotation.z=side*-.7;
          const eye=part(sphere,dark,side*.37,1.35,.79,.065,.09,.04);eye.name='eye';
          part(sphere,blush,side*.65,1.08,.72,.18,.08,.035);
          const arm=part(sphere,skin,side*1.05,.65,.2,.21,.4,.23);arm.rotation.z=side*.4;
        }
        part(sphere,dark,0,1.04,.87,.055,.025,.025);
        const leaf=part(sphere,moss,.23,2.5,0,.17,.55,.07);leaf.rotation.z=-.7;
        const leaf2=part(sphere,moss,-.2,2.43,0,.15,.42,.07);leaf2.rotation.z=.8;
        part(new T.BoxGeometry(.48,.48,.24),mat("#c9ae7d"),.92,.65,.65);
        const ripple=add(new T.TorusGeometry(.9,.025,5,50),cream,-1,.11,1);ripple.rotation.x=-Math.PI/2;
        scene.add(home);
        const resize = () => {
          const rect = canvas.getBoundingClientRect();
          renderer.setSize(rect.width, rect.height, false);
          camera.aspect = rect.width / Math.max(1, rect.height);
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        );
        const projected = new T.Vector3(),
          target = new T.Vector3(),
          desiredLook = new T.Vector3();
        let frame = 0,
          last = 0;
        const render = (time: number) => {
          if (destroyed) return;
          frame = requestAnimationFrame(render);
          if (document.hidden || time - last < 32) return;
          last = time;
          const state = current.current;
          const chosenIndex = state.beings.findIndex(
            (b) => b.id === state.selected,
          );
          const chosen = state.beings[chosenIndex];
          if (state.habitat && chosen) {
            const [x, z] = positionFor(chosen, chosenIndex);
            target.set(x + 5, heightAt(x, z) + 9, z + 17);
            desiredLook.set(x - 1, heightAt(x, z) - 1.2, z);
          } else {
            const zoomLevel = Math.max(0.7, Math.min(2, state.zoom));
            target.set(15 / zoomLevel, 31 / zoomLevel, 49 / zoomLevel);
            desiredLook.set(0, 2, -8);
          }
          home.visible=Boolean(state.habitat && chosen);
          if(chosen){
            const [hx,hz]=positionFor(chosen,chosenIndex);
            home.position.set(hx,heightAt(hx,hz)+.2,hz);
            const forest=/forest|tree|wood|plant/.test(chosen.kind);
            const alpine=/mountain|ridge|snow|alpine/.test(chosen.kind);
            const animal=/bear|elk|animal|wildlife|species/.test(chosen.kind);
            skin.color.set(forest?'#c8e4a6':alpine?'#e2d5ef':animal?'#efcfaa':'#c5eee0');
            leaf.visible=!animal;leaf2.visible=!animal;
            const asleep=!chosen.status || chosen.status==='asleep';
            const t=reducedMotion.matches?0:time*.001;
            creature.position.set(Math.sin(t*.22)*.35,asleep?.05:Math.sin(t*1.2)*.12+.1,0);
            creature.rotation.y=.25+Math.sin(t*.2)*.15;
            creature.rotation.z=asleep?-.08:Math.sin(t*.7)*.025;
            creature.children.filter(o=>o.name==='eye').forEach(o=>o.scale.y=asleep?.018:(!reducedMotion.matches && (time%6500)>6300?.014:.09));
            ripple.scale.setScalar(1+Math.sin(t*.6)*.1);
            pond.visible=/creek|water|lake|river|reservoir/.test(chosen.kind);
            ripple.visible=pond.visible;
          }
          camera.position.lerp(target, reducedMotion.matches ? 1 : 0.045);
          look.lerp(desiredLook, reducedMotion.matches ? 1 : 0.045);
          camera.lookAt(look);
          camera.updateMatrixWorld();
          if (!reducedMotion.matches)
            sparks.position.y = Math.sin(time * 0.0003) * 0.4;
          for (let i = 0; i < state.beings.length; i++) {
            const being = state.beings[i]!;
            const marker = markerRefs.current.get(being.id);
            if (!marker) continue;
            const [x, z] = positionFor(being, i);
            projected.set(x, heightAt(x, z) + 1.7, z).project(camera);
            const phone = canvas.clientWidth < 600 && !state.habitat;
            const mobileSlots = [
              [29, 76],
              [74, 53],
              [30, 56],
              [76, 89],
            ];
            const slot = mobileSlots[i % mobileSlots.length]!;
            marker.style.left = `${phone ? slot[0] : (projected.x * 0.5 + 0.5) * 100}%`;
            marker.style.top = `${phone ? slot[1] : (-projected.y * 0.5 + 0.5) * 100}%`;
            const hidden =
              projected.z > 1 || (state.habitat && being.id !== state.selected);
            marker.style.visibility = hidden ? "hidden" : "visible";
            marker.dataset.physical = state.habitat ? "true" : "false";
          }
          renderer.render(scene, camera);
        };
        render(0);
        setReady(true);
        const lost = (event: Event) => {
          event.preventDefault();
          setReady(false);
          cancelAnimationFrame(frame);
        };
        canvas.addEventListener("webglcontextlost", lost);
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          canvas.removeEventListener("webglcontextlost", lost);
          scene.traverse((object) => {
            if (object instanceof T.Mesh || object instanceof T.Points) {
              object.geometry.dispose();
              for (const material of Array.isArray(object.material)
                ? object.material
                : [object.material])
                material.dispose();
            }
          });
          renderer.dispose();
        };
      })
      .catch(() => setReady(false));
    return () => {
      destroyed = true;
      cleanup();
    };
  }, []);
  return (
    <div
      className={`${styles.world} ${habitat ? styles.habitat : ""} ${ready ? styles.ready : ""} ${className}`}
    >
      <svg
        className={styles.fallback}
        viewBox="0 0 1400 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={skyId} x2="0" y2="1">
            <stop stopColor="#b9d4d4" />
            <stop offset="1" stopColor="#f2eecb" />
          </linearGradient>
        </defs>
        <path fill={`url(#${skyId})`} d="M0 0h1400v900H0z" />
        <path
          fill="#9fb5aa"
          d="M0 390L170 210 240 290 400 140 540 310 700 175 880 330 1080 170 1240 300 1400 210V900H0Z"
        />
        <path
          fill="#cfd7c6"
          d="M330 214l70-74 80 105-63-23-30 18-22-35zM1010 238l70-68 57 69-40-8-24 19-19-27z"
        />
        <path
          fill="#7b9c81"
          d="M0 500Q230 310 480 490T950 410T1400 440V900H0Z"
        />
        <path
          fill="#587f64"
          d="M0 660Q260 470 560 620T1100 580T1400 620V900H0Z"
        />
        <path
          fill="none"
          stroke="#a2d1c3"
          strokeWidth="24"
          d="M760 470Q900 550 760 630T880 790T740 930"
        />
        {Array.from({ length: 75 }, (_, i) => {
          const x = (i * 173) % 1400,
            y = 570 + ((i * 71) % 300);
          return (
            <path
              key={i}
              d={`M${x} ${y}l-17 40h12l-20 28h49l-19-28h12z`}
              fill={i % 2 ? "#416e56" : "#6a8c64"}
            />
          );
        })}
      </svg>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <div className={styles.haze} />
      <div className={styles.markers} aria-label="Beings in this landscape">
        {beings.map((being, i) => (
          <button
            key={being.id}
            ref={(node) => {
              if (node) markerRefs.current.set(being.id, node);
              else markerRefs.current.delete(being.id);
            }}
            className={styles.marker}
            style={{
              left: `${42 + ((i * 17) % 45)}%`,
              top: `${48 + ((i * 11) % 28)}%`,
            }}
            onClick={() => onSelect?.(being.id)}
            aria-label={`Visit ${being.name}`}
            aria-pressed={selected === being.id}
          >
            <span className={styles.markerSprite}>
              <Sprite
                kind={being.kind}
                mood={
                  being.status && being.status !== "asleep"
                    ? being.status
                    : "asleep"
                }
              />
            </span>
            <span className={styles.markerLabel}>
              <span className={styles.statusDot} />
              {being.name}
            </span>
          </button>
        ))}
      </div>
      <div className={styles.caption}>
        {measured ? "USGS elevation via Mapzen / AWS · 2.5× relief · artistic vegetation" : "Illustrated habitat · terrain unavailable"}
        {habitat && " · Habitat details are artistic"}
      </div>
    </div>
  );
}
