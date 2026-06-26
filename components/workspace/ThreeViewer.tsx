"use client";

import { Canvas } from "@react-three/fiber";
import { Edges, Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

const plate = {
  length: 120,
  width: 80,
  thickness: 4,
  holeDiameter: 4.5,
  edgeOffset: 10,
  chamfer: 1,
};

export function ThreeViewer() {
  return (
    <div className="three-frame" data-testid="three-viewer">
      <Canvas dpr={[1, 2]} shadows>
        <PerspectiveCamera makeDefault position={[96, 84, 84]} fov={36} />
        <color attach="background" args={["#111827"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[80, 90, 120]} intensity={2.2} castShadow />
        <directionalLight position={[-60, 40, -80]} intensity={0.7} />
        <MountingPlate />
        <Grid
          args={[180, 24]}
          cellSize={10}
          cellThickness={0.45}
          cellColor="#35506b"
          sectionSize={40}
          sectionThickness={0.8}
          sectionColor="#54708f"
          position={[0, -4, 0]}
        />
        <OrbitControls enableDamping makeDefault />
      </Canvas>
      <div className="viewer-hud">
        <span>ISO</span>
        <span>Edges on</span>
        <span>Al 6061</span>
      </div>
    </div>
  );
}

function MountingPlate() {
  const geometry = useMemo(() => {
    const { length, width, thickness, holeDiameter, edgeOffset, chamfer } = plate;
    const shape = new THREE.Shape();
    const halfLength = length / 2;
    const halfWidth = width / 2;
    const radius = holeDiameter / 2;

    shape.moveTo(-halfLength, -halfWidth);
    shape.lineTo(halfLength, -halfWidth);
    shape.lineTo(halfLength, halfWidth);
    shape.lineTo(-halfLength, halfWidth);
    shape.lineTo(-halfLength, -halfWidth);

    const holes = [
      [-halfLength + edgeOffset, -halfWidth + edgeOffset],
      [halfLength - edgeOffset, -halfWidth + edgeOffset],
      [-halfLength + edgeOffset, halfWidth - edgeOffset],
      [halfLength - edgeOffset, halfWidth - edgeOffset],
    ];

    holes.forEach(([x, y]) => {
      const path = new THREE.Path();
      path.absellipse(x, y, radius, radius, 0, Math.PI * 2, false, 0);
      shape.holes.push(path);
    });

    const safeChamfer = Math.min(chamfer, thickness / 3);
    const meshGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: true,
      bevelSize: safeChamfer,
      bevelThickness: safeChamfer,
      bevelSegments: 3,
      steps: 1,
    });
    meshGeometry.center();
    meshGeometry.rotateX(-Math.PI / 2);
    meshGeometry.computeVertexNormals();
    return meshGeometry;
  }, []);

  return (
    <group rotation={[0, 0.05, -0.08]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#8cc8e8" metalness={0.55} roughness={0.34} />
        <Edges color="#e5f4ff" threshold={18} />
      </mesh>
      <mesh position={[0, 2.8, 0]}>
        <boxGeometry args={[121, 0.45, 81]} />
        <meshBasicMaterial color="#3dd6a6" transparent opacity={0.28} />
      </mesh>
    </group>
  );
}
