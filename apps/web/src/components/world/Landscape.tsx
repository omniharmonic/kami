"use client";

import { useEffect, useId, useRef, useState } from "react";
import type * as THREE from "three";
import { Sprite } from "./Sprite";
import styles from "./world.module.css";

export type WorldBeing = {
  id: string;
  name: string;
  kind: string;
  x?: number;
  y?: number;
  status?: string;
};
export type LandscapeProps = {
  beings: WorldBeing[];
  selected?: string | null;
  onSelect?: (id: string) => void;
  zoom?: number;
  habitat?: boolean;
  className?: string;
};

// A scenic interpretation, not a geographic data layer. The warm horizon/cool shadow
// lighting follows Benjamin Life's Front Range Twin art direction (Apache-2.0),
// bioregional_twin/web/src/map/atmosphere.ts. No DEM or sensor geometry is fabricated.
function heightAt(x: number, z: number): number {
  const ridge = Math.exp(-(((z + 30) / 15) ** 2));
  const peaks =
    9 + 5 * Math.sin(x * 0.13 + 1) ** 2 + 3 * Math.sin(x * 0.29) ** 2;
  const hills =
    1.5 +
    2.1 * Math.sin(x * 0.08 + z * 0.045) +
    1.1 * Math.cos(z * 0.14 - x * 0.055);
  const creek = Math.exp(-(((x - riverX(z)) / 3.3) ** 2));
  return Math.max(0.1, hills * (1 - creek * 0.85) + ridge * peaks);
}
function riverX(z: number): number {
  return 6 + Math.sin(z * 0.115) * 5 + Math.sin(z * 0.055) * 4;
}
function positionFor(being: WorldBeing, index: number): [number, number] {
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
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let destroyed = false;
    let cleanup = () => {};
    void import("three")
      .then((T) => {
        if (destroyed) return;
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
        scene.background = new T.Color("#c5d8cf");
        scene.fog = new T.FogExp2("#c5d8cf", 0.0085);
        const camera = new T.PerspectiveCamera(43, 1, 0.1, 260);
        camera.position.set(15, 31, 49);
        const look = new T.Vector3(0, 2, -8);
        const sun = new T.DirectionalLight("#fff0cf", 2.0);
        sun.position.set(-28, 38, 12);
        scene.add(sun, new T.HemisphereLight("#e7f1de", "#375d48", 1.4));
        const terrain = new T.PlaneGeometry(150, 135, 180, 160);
        terrain.rotateX(-Math.PI / 2);
        const pos = terrain.attributes.position!;
        const colors = new Float32Array(pos.count * 3);
        const low = new T.Color("#4d855f"),
          high = new T.Color("#829a77"),
          snow = new T.Color("#e4e8d9");
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
        const streamPositions: number[] = [],
          streamIndices: number[] = [];
        for (let i = 0; i <= 230; i++) {
          const z = -30 + i * 0.4,
            x = riverX(z),
            width = 0.48 + (z + 30) * 0.018;
          for (const side of [-1, 1])
            streamPositions.push(x + side * width, heightAt(x, z) + 0.14, z);
          if (i < 230) {
            const a = i * 2;
            streamIndices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          }
        }
        const riverGeometry = new T.BufferGeometry();
        riverGeometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(streamPositions, 3),
        );
        riverGeometry.setIndex(streamIndices);
        riverGeometry.computeVertexNormals();
        scene.add(
          new T.Mesh(
            riverGeometry,
            new T.MeshStandardMaterial({
              color: "#92d8ce",
              metalness: 0.3,
              roughness: 0.26,
              side: T.DoubleSide,
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
          new T.ConeGeometry(0.8, 2.7, 7),
          new T.MeshStandardMaterial({
            color: "#4e7958",
            roughness: 1,
            flatShading: true,
          }),
          treeCount,
        );
        const lower = new T.InstancedMesh(
          new T.ConeGeometry(1, 2.8, 7),
          new T.MeshStandardMaterial({
            color: "#3b6950",
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
            if (Math.abs(x - riverX(z)) > 2.3 && heightAt(x, z) < 13) break;
          }
          const size = 0.45 + random() * 0.75,
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
            0.28 + random() * 0.17,
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
            x = riverX(z) + (random() > 0.5 ? 1 : -1) * (2 + random() * 4);
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
          cloud.scale.set(8 + random() * 13, 0.8 + random(), 2 + random() * 3);
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
            target.set(x + 10, heightAt(x, z) + 15, z + 24);
            desiredLook.set(x, heightAt(x, z) + 2, z);
          } else {
            const zoomLevel = Math.max(0.7, Math.min(2, state.zoom));
            target.set(15 / zoomLevel, 31 / zoomLevel, 49 / zoomLevel);
            desiredLook.set(0, 2, -8);
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
        An illustrated Front Range habitat · ecological readings live in each
        being’s journal
      </div>
    </div>
  );
}
