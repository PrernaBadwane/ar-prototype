"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function ProductAR() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const launchAR = () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
      const quickLook = document.createElement("a");
      quickLook.rel = "ar";
      quickLook.href = "/models/testImage.usdz";
      quickLook.click();
    } else {
      const sceneViewerUrl =
        `intent://arvr.google.com/scene-viewer/1.0?file=` +
        encodeURIComponent(`${window.location.origin}/models/testImage.glb`) +
        `&mode=ar_only&link=${encodeURIComponent(window.location.href)}#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=` +
        encodeURIComponent(window.location.origin) +
        ";end;";

      window.location.href = sceneViewerUrl;
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (typeof window === "undefined") return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      100
    );
    camera.position.set(0, 1, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    scene.add(light);

    // --- FIX: Dynamic import for GLTFLoader ---
    const loadModel = async () => {
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );

      const loader = new GLTFLoader();

      loader.load(
        "/models/testImage.glb",
        (gltf) => {
          const model = gltf.scene;
          model.scale.set(1, 1, 1);
          scene.add(model);
        },
        undefined,
        (err) => console.error("GLB Load Error:", err)
      );
    };

    loadModel();

    const animate = () => {
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };
    animate();

    return () => {
      container.innerHTML = "";
    };
  }, []);

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center">
      <h2 className="text-xl font-bold mb-4">3D Product Preview</h2>

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "400px",
          background: "#000",
        }}
      ></div>

      <button
        onClick={launchAR}
        className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg"
      >
        View in Your Room
      </button>
    </div>
  );
}



