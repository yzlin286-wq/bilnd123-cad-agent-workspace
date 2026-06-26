"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Edges, Grid, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import type { CADArtifact } from "@/lib/agent/spec";

export function RealModelViewer({ artifact, loading }: { artifact?: CADArtifact; loading: boolean }) {
  if (loading && !artifact) {
    return <div className="preview-skeleton">Generating preview mesh...</div>;
  }
  if (!artifact) {
    return <div className="empty-panel">A real STL preview from build123d will appear here.</div>;
  }

  return (
    <div className="real-viewer">
      <Canvas dpr={[1, 2]} shadows>
        <PerspectiveCamera makeDefault position={[110, 90, 120]} fov={36} />
        <color attach="background" args={["#050a12"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[90, 120, 100]} intensity={2.6} />
        <directionalLight position={[-60, 30, -90]} intensity={0.8} />
        <Bounds fit clip observe margin={1.25}>
          <STLMesh url={artifact.url} />
        </Bounds>
        <Grid
          args={[220, 28]}
          cellSize={10}
          cellThickness={0.45}
          cellColor="#1f4f65"
          sectionSize={40}
          sectionThickness={0.8}
          sectionColor="#2dd4bf"
          position={[0, -8, 0]}
        />
        <OrbitControls enableDamping makeDefault />
      </Canvas>
      <div className="viewer-label">Live artifact: {artifact.name}</div>
    </div>
  );
}

function STLMesh({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  geometry.computeVertexNormals();
  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <meshStandardMaterial color="#6fe7d2" metalness={0.42} roughness={0.32} />
      <Edges color="#d9fff8" threshold={20} />
    </mesh>
  );
}
