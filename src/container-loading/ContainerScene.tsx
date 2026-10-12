import React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { ContainerPlacement, ContainerType } from "./types";
import { skuColorHex } from "./color";

type Props = {
  container: ContainerType;
  placements: ContainerPlacement[];
  selectedId: string;
  showShell: boolean;
  editable: boolean;
  maxSequence: number;
  onSelect: (placementId: string) => void;
  onMove: (placementId: string, position: { x: number; y: number; z: number }) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ContainerScene({ container, placements, selectedId, showShell, editable, maxSequence, onSelect, onMove }: Props) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const scale = 0.01;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xf4f7fb, 16, 32);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / Math.max(1, mount.clientHeight), 0.01, 100);
    const length = container.lengthCm * scale;
    const width = container.widthCm * scale;
    const height = container.heightCm * scale;
    camera.position.set(length * 0.72, height * 1.6, width * 1.9);
    camera.lookAt(0, height * 0.38, 0);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, height * 0.36, 0);
    orbit.maxPolarAngle = Math.PI * 0.49;
    orbit.minDistance = 2;
    orbit.maxDistance = Math.max(18, length * 2.5);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x6883a4, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(length * 0.2, height * 3, width * 2);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(length + 1.2, width + 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe7eef7, roughness: 0.94, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(Math.max(length, width) + 1, 28, 0xadc1d8, 0xd9e3ef);
    grid.position.y = 0.001;
    scene.add(grid);

    if (showShell) {
      const shellGeometry = new THREE.BoxGeometry(length, height, width);
      const shell = new THREE.Mesh(shellGeometry, new THREE.MeshPhysicalMaterial({ color: 0x1b5fa8, transparent: true, opacity: 0.055, side: THREE.BackSide, roughness: 0.2 }));
      shell.position.y = height / 2;
      scene.add(shell);
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry), new THREE.LineBasicMaterial({ color: 0x2a70b8, transparent: true, opacity: 0.56 }));
      outline.position.copy(shell.position);
      scene.add(outline);
      const door = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(container.doorWidthCm * scale, container.doorHeightCm * scale)),
        new THREE.LineBasicMaterial({ color: 0xf45b0b, transparent: true, opacity: 0.9 }),
      );
      door.rotation.y = Math.PI / 2;
      door.position.set(length / 2 + 0.012, container.doorHeightCm * scale / 2, 0);
      scene.add(door);
    }

    const meshById = new Map<string, THREE.Mesh>();
    const raycastTargets: THREE.Mesh[] = [];
    const visiblePlacements = placements
      .filter((placement) => !maxSequence || placement.sequence <= maxSequence)
      .slice(0, 1500);
    for (const placement of visiblePlacements) {
      const geometry = new THREE.BoxGeometry(placement.lengthCm * scale * 0.985, placement.heightCm * scale * 0.985, placement.widthCm * scale * 0.985);
      const color = new THREE.Color(skuColorHex(placement.sku));
      const selected = placement.placementId === selectedId;
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.68,
        metalness: 0.03,
        transparent: true,
        opacity: placement.locked ? 0.72 : 0.92,
        emissive: selected ? new THREE.Color(0xff7b32) : new THREE.Color(0x000000),
        emissiveIntensity: selected ? 0.32 : 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        (placement.x + placement.lengthCm / 2 - container.lengthCm / 2) * scale,
        (placement.z + placement.heightCm / 2) * scale,
        (placement.y + placement.widthCm / 2 - container.widthCm / 2) * scale,
      );
      mesh.castShadow = visiblePlacements.length <= 700;
      mesh.receiveShadow = visiblePlacements.length <= 700;
      mesh.userData.placementId = placement.placementId;
      scene.add(mesh);
      meshById.set(placement.placementId, mesh);
      raycastTargets.push(mesh);
      if (selected) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xff5b0b, linewidth: 2 }));
        mesh.add(edges);
      }
    }

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart = { x: 0, y: 0 };
    const handlePointerDown = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY }; };
    const handlePointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(raycastTargets, false)[0];
      onSelect(hit ? String(hit.object.userData.placementId || "") : "");
    };
    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointerup", handlePointerUp);

    let transform: TransformControls | null = null;
    const selectedPlacement = placements.find((placement) => placement.placementId === selectedId);
    const selectedMesh = selectedId ? meshById.get(selectedId) : null;
    if (editable && selectedMesh && selectedPlacement && !selectedPlacement.locked) {
      transform = new TransformControls(camera, renderer.domElement);
      transform.setMode("translate");
      transform.setSpace("world");
      transform.setTranslationSnap(0.01);
      transform.setSize(0.72);
      transform.attach(selectedMesh);
      scene.add(transform);
      transform.addEventListener("dragging-changed", (event) => { orbit.enabled = !Boolean(event.value); });
      transform.addEventListener("mouseUp", () => {
        const x = clamp((selectedMesh.position.x / scale) + container.lengthCm / 2 - selectedPlacement.lengthCm / 2, 0, container.lengthCm - selectedPlacement.lengthCm);
        const y = clamp((selectedMesh.position.z / scale) + container.widthCm / 2 - selectedPlacement.widthCm / 2, 0, container.widthCm - selectedPlacement.widthCm);
        const z = clamp((selectedMesh.position.y / scale) - selectedPlacement.heightCm / 2, 0, container.heightCm - selectedPlacement.heightCm);
        onMove(selectedPlacement.placementId, { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
      });
    }

    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = new ResizeObserver(() => {
      const widthPx = Math.max(1, mount.clientWidth);
      const heightPx = Math.max(1, mount.clientHeight);
      camera.aspect = widthPx / heightPx;
      camera.updateProjectionMatrix();
      renderer.setSize(widthPx, heightPx);
    });
    resize.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointerup", handlePointerUp);
      transform?.detach();
      transform?.dispose();
      orbit.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose?.();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [container, editable, maxSequence, onMove, onSelect, placements, selectedId, showShell]);

  return <div className="cl-scene" ref={mountRef}><div className="cl-scene-hint">拖动空白旋转视角 · 滚轮缩放 · 点击箱体查看 · 选中后拖动坐标轴调整</div></div>;
}
