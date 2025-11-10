/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useEffect, useRef } from "react";

export default function ARPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    (async function init() {
      const THREE = await import("three");
      const { ARButton } = await import("three/examples/jsm/webxr/ARButton.js");
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );

      const container = containerRef.current!;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.domElement.style.position = "absolute";
      renderer.domElement.style.top = "0";
      renderer.domElement.style.left = "0";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      // better lighting
      scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5));
      scene.add(new THREE.DirectionalLight(0xffffff, 1));

      // reticle
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x00ff00 })
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      // load model (fallback cube first)
      const loader = new GLTFLoader();
      let model: any = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshStandardMaterial({ color: 0x00aaff })
      );
      model.visible = false;
      scene.add(model);

      loader.load(
        "/models/oldphone.glb",
        (gltf) => {
          scene.remove(model);
          model = gltf.scene;
          model.scale.set(0.5, 0.5, 0.5);
          model.visible = false;
          scene.add(model);
        },
        undefined,
        (err) => console.warn("GLTF load error", err)
      );

      // --- WebXR setup ---
      if (!(navigator as any).xr) {
        alert("WebXR not supported on this browser/device");
        return;
      }

      const button = ARButton.createButton(renderer, { requiredFeatures: ["hit-test"] });
      document.body.appendChild(button);

      let hitTestSource: XRHitTestSource | null = null;
      let localRefSpace: XRReferenceSpace | null = null;

      // Start session when ARButton triggers
      renderer.xr.addEventListener("sessionstart", async () => {
        const session = renderer.xr.getSession();
        if (!session) return;
        const refSpace = await session.requestReferenceSpace("viewer");
        hitTestSource = await (navigator as any).xr.requestHitTestSource({ space: refSpace });
        localRefSpace = await session.requestReferenceSpace("local");

        session.addEventListener("end", () => {
          hitTestSource = null;
          localRefSpace = null;
        });
      });

      // animation loop
      renderer.setAnimationLoop((timestamp, frame) => {
        if (frame && hitTestSource && localRefSpace) {
          const hits = frame.getHitTestResults(hitTestSource);
          if (hits.length > 0) {
            const hitPose = hits[0].getPose(localRefSpace);
            if (hitPose) {
              reticle.visible = true;
              reticle.matrix.fromArray(hitPose.transform.matrix);
            }
          } else reticle.visible = false;
        }
        renderer.render(scene, camera);
      });

      // tap to place model
      renderer.domElement.addEventListener("click", () => {
        if (!reticle.visible || !model) return;
        model.position.setFromMatrixPosition(reticle.matrix);
        model.visible = true;
      });

      // --- Screenshot button ---
      const btn = document.createElement("button");
      btn.innerText = "📸 Capture";
      Object.assign(btn.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "10px 18px",
        background: "#000",
        color: "#fff",
        borderRadius: "12px",
        fontSize: "16px",
        zIndex: "99999",
      });
      btn.onclick = () => {
        const data = renderer.domElement.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = data;
        a.download = "ar-capture.png";
        a.click();
      };
      document.body.appendChild(btn);

      // resize
      window.addEventListener("resize", () =>
        renderer.setSize(window.innerWidth, window.innerHeight)
      );
    })();
  }, []);

  return <div ref={containerRef} style={{ width: "100vw", height: "100vh" }} />;
}
