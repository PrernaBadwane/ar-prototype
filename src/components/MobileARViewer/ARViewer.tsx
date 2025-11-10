/* eslint-disable @typescript-eslint/no-explicit-any */
// pages/ar.tsx
"use client";
import { useEffect, useRef } from "react";

export default function ARPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // run only in browser
    if (typeof window === "undefined") return;
    let mounted = true;
    (async function init() {
      // dynamic import to avoid SSR issues
      const THREE = await import("three");
      const { ARButton } = await import("three/examples/jsm/webxr/ARButton.js");
      const { GLTFLoader } = await import(
        "three/examples/jsm/loaders/GLTFLoader.js"
      );

      const container = containerRef.current!;
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.domElement.style.position = "absolute";
      renderer.domElement.style.top = "0";
      renderer.domElement.style.left = "0";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();

      // lighting for model appearance
      const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
      scene.add(light);

      // Reticle (hit-test indicator)
      const reticleGeometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(
        -Math.PI / 2
      );
      const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      // Load model (replace url)
      const loader = new GLTFLoader();
      let model: import("three").Object3D | null = null;
      loader.load("/models/oldphone.glb", (gltf) => {
        model = gltf.scene;
        model.visible = false; // show only after placement
        model.scale.set(0.5, 0.5, 0.5); // a starting scale, tune per model
        scene.add(model);
      });

      // WebXR hit test setup
      let xrSession: XRSession | null = null;
      const onSessionStart = async (session: any) => {
        xrSession = session;
        renderer.xr.setSession(session);

        // request a transient hit-test source using viewer space
        const refSpace = await session.requestReferenceSpace("viewer");
        const hitTestSource = await (navigator as any).xr.requestHitTestSource({
          space: refSpace,
        });

        const localRefSpace = await session.requestReferenceSpace("local");

        // animation loop
        renderer.setAnimationLoop((timestamp, xrFrame) => {
          if (!xrFrame) return;
          const session = xrFrame.session;
          const pose = xrFrame.getViewerPose(localRefSpace);
          // perform hit test
          const hitTestResults = xrFrame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            reticle.visible = true;
            const hitPose = hit.getPose(localRefSpace);
            if (hitPose) {
              reticle.visible = true;
              reticle.matrix.fromArray(hitPose.transform.matrix as any);
            } else {
              reticle.visible = false;
            }
          } else {
            reticle.visible = false;
          }
          renderer.render(scene, camera);
        });

        // handle tap -> place model at reticle
        session.addEventListener("select", () => {
          if (!reticle.visible || !model) return;
          model.position.setFromMatrixPosition(reticle.matrix);
          // orient model to face the camera (optional)
          const m = new THREE.Matrix4().extractRotation(reticle.matrix);
          model.quaternion.setFromRotationMatrix(m);
          model.visible = true;
        });
      };

      // add AR button (will be hidden on unsupported browsers)
      document.body.appendChild(
        ARButton.createButton(renderer, { requiredFeatures: ["hit-test"] })
      );
      ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"],
      }) as HTMLElement;

      // Gesture controls (touch) - basic implementation
      // We'll do manual touch handlers to scale/rotate/translate the placed model
      let ongoingTouches: TouchList | null = null;
      let lastTouchDistance = 0;
      let lastRotation = 0;
      let lastSingleTouch = { x: 0, y: 0 };

      function getTouchPos(t: Touch) {
        return { x: t.clientX, y: t.clientY };
      }

      function distanceBetweenTouches(t1: Touch, t2: Touch) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.hypot(dx, dy);
      }

      function rotationBetweenTouches(t1: Touch, t2: Touch) {
        return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
      }

      renderer.domElement.addEventListener(
        "touchstart",
        (ev) => {
          if (!model) return;
          if (ev.touches.length === 1) {
            lastSingleTouch = getTouchPos(ev.touches[0]);
          } else if (ev.touches.length === 2) {
            lastTouchDistance = distanceBetweenTouches(
              ev.touches[0],
              ev.touches[1]
            );
            lastRotation = rotationBetweenTouches(ev.touches[0], ev.touches[1]);
          }
        },
        { passive: true }
      );

      renderer.domElement.addEventListener(
        "touchmove",
        (ev) => {
          if (!model) return;
          ev.preventDefault();
          if (ev.touches.length === 1 && model.visible) {
            // single-finger drag -> move model parallel to camera plane
            const touch = ev.touches[0];
            const dx = (touch.clientX - lastSingleTouch.x) / window.innerWidth;
            const dy = (touch.clientY - lastSingleTouch.y) / window.innerHeight;
            // scale delta to reasonable world units
            const moveFactor = 1.0; // tune this factor
            const cameraDir = new THREE.Vector3();
            renderer.xr.getCamera().getWorldDirection(cameraDir);

            // move along camera right and up axes
            const cam = renderer.xr.getCamera();
            const right = new THREE.Vector3();
            cam.matrix.extractBasis(
              right,
              new THREE.Vector3(),
              new THREE.Vector3()
            );
            model.position.addScaledVector(right, dx * moveFactor);
            const up = new THREE.Vector3(0, 1, 0);
            model.position.addScaledVector(up, -dy * moveFactor);

            lastSingleTouch = getTouchPos(touch);
          } else if (ev.touches.length === 2 && model.visible) {
            const d = distanceBetweenTouches(ev.touches[0], ev.touches[1]);
            const scaleChange = d / lastTouchDistance;
            model.scale.multiplyScalar(scaleChange);
            lastTouchDistance = d;

            const rot = rotationBetweenTouches(ev.touches[0], ev.touches[1]);
            const deltaRot = rot - lastRotation;
            // rotate around Y axis
            model.rotateY(deltaRot);
            lastRotation = rot;
          }
        },
        { passive: false }
      );

      renderer.domElement.addEventListener("touchend", (ev) => {
        // nothing special for now
      });

      // screenshot / save
      async function takeScreenshot() {
        // Option A: try renderer.domElement.toDataURL
        try {
          const data = renderer.domElement.toDataURL("image/png");
          const a = document.createElement("a");
          a.href = data;
          a.download = "ar-capture.png";
          a.click();
          return;
        } catch (err) {
          console.warn(
            "direct toDataURL failed, trying composite fallback",
            err
          );
        }
        // Option B: composite camera feed + renderer canvas (fallback)
        try {
          // get camera stream frame if available
          const videoStream = await (
            navigator.mediaDevices as any
          ).getUserMedia({ video: true });
          const track = videoStream.getVideoTracks()[0];
          const imageCapture = new (window as any).ImageCapture(track);
          const bitmap = await imageCapture.grabFrame();
          // draw to canvas
          const c = document.createElement("canvas");
          c.width = renderer.domElement.width;
          c.height = renderer.domElement.height;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(bitmap, 0, 0, c.width, c.height);
          // draw three renderer on top (renderer.domElement might be transparent)
          ctx.drawImage(renderer.domElement, 0, 0);
          const data = c.toDataURL("image/png");
          const a = document.createElement("a");
          a.href = data;
          a.download = "ar-capture.png";
          a.click();
          track.stop();
        } catch (err) {
          console.error("screenshot fallback failed:", err);
          alert("Unable to capture screenshot on this device.");
        }
      }

      // attach UI controls
      const screenshotBtn = document.createElement("button");
      screenshotBtn.textContent = "Capture";
      screenshotBtn.style.position = "absolute";
      screenshotBtn.style.bottom = "20px";
      screenshotBtn.style.left = "20px";
      screenshotBtn.style.zIndex = "9999";
      screenshotBtn.addEventListener("click", takeScreenshot);
      container.appendChild(screenshotBtn);

      // cleanup
      window.addEventListener("resize", () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
      });
    })();

    return () => {
      mounted = false;
      // TODO: dispose renderer, scene etc. (left as exercise)
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100vw", height: "100vh", position: "relative" }}
    >
      {/* The ARButton by three.js is injected into the DOM by threejs examples */}
      <div style={{ position: "absolute", zIndex: 9999, right: 20, top: 20 }}>
        {/* Optionally include an iOS Quick Look fallback link here */}
        <a id="quicklook-link" style={{ display: "none" }}>
          View in Quick Look
        </a>
      </div>
    </div>
  );
}
