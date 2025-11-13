/* eslint-disable @typescript-eslint/no-explicit-any */
//@ts-nocheck
"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface ARState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  reticle: THREE.Mesh | null;
  model: THREE.Object3D | null;
  hitTestSource: XRHitTestSource | null;
  localRefSpace: XRReferenceSpace | null;
  xrSession: XRSession | null;
  lastTouchDistance: number;
  lastRotation: number;
  lastSingleTouch: { x: number; y: number };
  modelPlaced: boolean;
}

export default function ARPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const arState = useRef<ARState>({
    renderer: null,
    scene: null,
    camera: null,
    reticle: null,
    model: null,
    hitTestSource: null,
    localRefSpace: null,
    xrSession: null,
    lastTouchDistance: 0,
    lastRotation: 0,
    lastSingleTouch: { x: 0, y: 0 },
    modelPlaced: false,
  });

  const [arSupported, setArSupported] = useState(false);
  const [inSession, setInSession] = useState(false);
  const [loadingModel, setLoadingModel] = useState(true);
  const modelPathGLB = "/models/testImage.glb"; // ensure this path exists in public/
  const modelPathUSDZ = "/models/testImage.usdz"; // optional for iOS quick look

  // keep references to handlers to remove them later
  const handlersRef = useRef<{ [k: string]: any }>({});

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    // check WebXR support
    (async () => {
      if ("xr" in navigator && (navigator as any).xr.isSessionSupported) {
        const supported = await (navigator as any).xr.isSessionSupported(
          "immersive-ar"
        );
        setArSupported(supported);
      } else {
        setArSupported(false);
      }
    })();

    // Setup three.js scene and renderer (canvas) now, used for both AR and non-AR previews
    const container = containerRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.01,
      20
    );

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true; // allow WebXR
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0px";
    renderer.domElement.style.left = "0px";
    container.appendChild(renderer.domElement);

    arState.current.renderer = renderer;
    arState.current.scene = scene;
    arState.current.camera = camera;

    // Light
    const hemi = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
    scene.add(hemi);

    // Reticle
    const ring = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const reticle = new THREE.Mesh(ring, ringMat);
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);
    arState.current.reticle = reticle;

    // Load model (hidden until placed)
    const loader = new GLTFLoader();
    loader.load(
      modelPathGLB,
      (gltf) => {
        const model = gltf.scene;
        model.visible = false;
        model.scale.set(0.1, 0.1, 0.1);
        model.position.set(0, 0, -1); // initial off-camera position
        scene.add(model);
        arState.current.model = model;
        setLoadingModel(false);
        console.log("Model loaded.");
      },
      undefined,
      (err) => {
        console.error("GLTF load error:", err);
        setLoadingModel(false);
      }
    );

    // Animation loop for rendering
    const animate = (time?: DOMHighResTimeStamp, frame?: XRFrame) => {
      // Update reticle via hit-test results only if in XR session
      if (frame && arState.current.xrSession) {
        const { reticle, hitTestSource, localRefSpace } = arState.current;
        if (hitTestSource && reticle && !arState.current.modelPlaced && localRefSpace) {
          const hitResults = frame.getHitTestResults(hitTestSource);
          if (hitResults.length > 0) {
            const hit = hitResults[0];
            const pose = hit.getPose(localRefSpace);
            if (pose) {
              reticle.matrix.fromArray(pose.transform.matrix);
              reticle.visible = true;
            } else {
              reticle.visible = false;
            }
          } else {
            reticle.visible = false;
          }
        }
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // Touch helpers (used both before and after placement to allow interaction)
    const getTouchPos = (t: Touch) => ({ x: t.clientX, y: t.clientY });
    const distanceBetweenTouches = (t1: Touch, t2: Touch) => {
      const dx = t1.clientX - t2.clientX;
      const dy = t1.clientY - t2.clientY;
      return Math.hypot(dx, dy);
    };
    const rotationBetweenTouches = (t1: Touch, t2: Touch) =>
      Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);

    // Touch handlers
    const touchStart = (event: TouchEvent) => {
      if (!arState.current.model || !arState.current.modelPlaced) return;

      if (event.touches.length === 1) {
        arState.current.lastSingleTouch = getTouchPos(event.touches[0]);
      } else if (event.touches.length === 2) {
        arState.current.lastTouchDistance = distanceBetweenTouches(
          event.touches[0],
          event.touches[1]
        );
        arState.current.lastRotation = rotationBetweenTouches(
          event.touches[0],
          event.touches[1]
        );
      }
      event.preventDefault();
    };

    const touchMove = (event: TouchEvent) => {
      if (!arState.current.model || !arState.current.modelPlaced) return;
      event.preventDefault();

      const model = arState.current.model!;
      const camera = arState.current.camera!;

      if (event.touches.length === 1) {
        // Drag logic: cast ray from camera to plane at model's y to move X/Z
        const touch = event.touches[0];
        const mouse = new THREE.Vector2();
        mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);

        const plane = new THREE.Plane();
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), model.position);

        const intersectionPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
          model.position.x = intersectionPoint.x;
          model.position.z = intersectionPoint.z;
        }

        arState.current.lastSingleTouch = getTouchPos(touch);
      } else if (event.touches.length === 2) {
        const d = distanceBetweenTouches(event.touches[0], event.touches[1]);
        const scaleChange = d / arState.current.lastTouchDistance;
        if (isFinite(scaleChange) && scaleChange > 0 && scaleChange < 5) {
          model.scale.multiplyScalar(scaleChange);
        }
        arState.current.lastTouchDistance = d;

        const rot = rotationBetweenTouches(event.touches[0], event.touches[1]);
        const deltaRot = rot - arState.current.lastRotation;
        model.rotateY(deltaRot);
        arState.current.lastRotation = rot;
      }
    };

    // We'll add listeners when session starts; keep them so we can remove later (safe to attach now but only used after placement)
    handlersRef.current.touchStart = touchStart;
    handlersRef.current.touchMove = touchMove;

    // Window resize
    const onWindowResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", onWindowResize);

    // Clean up on unmount
    return () => {
      console.log("Cleaning up AR component (unmount).");
      window.removeEventListener("resize", onWindowResize);
      renderer.setAnimationLoop(null);
      renderer.domElement.remove();
      renderer.dispose();
      // remove any XR session if still active
      if (arState.current.xrSession) {
        arState.current.xrSession.end();
      }
    };
  }, []); // run once

  // Start AR session when user clicks "Start AR"
  const startAR = async () => {
    if (!("xr" in navigator) || !(navigator as any).xr) {
      alert("WebXR not available in this browser.");
      return;
    }
    try {
      const session: XRSession = await (navigator as any).xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        // We will not pass domOverlay here to avoid cross-origin issues; using DOM overlay requires proper setup.
      });

      const renderer = arState.current.renderer!;
      await renderer.xr.setSession(session);
      arState.current.xrSession = session;
      setInSession(true);

      // Request reference spaces
      const viewerSpace = await session.requestReferenceSpace("viewer");
      arState.current.hitTestSource = await (session as any).requestHitTestSource({ space: viewerSpace });

      arState.current.localRefSpace = await session.requestReferenceSpace("local");

      // Add select listener - tap on screen on AR device triggers this
      const onSelect = () => {
        const reticle = arState.current.reticle;
        const model = arState.current.model;
        if (!reticle || !reticle.visible || !model) return;

        if (!arState.current.modelPlaced) {
          // Place the model at the reticle
          model.position.setFromMatrixPosition(reticle.matrix);
          // Orient model to same rotation as reticle (nice facing)
          const m = new THREE.Matrix4().extractRotation(reticle.matrix);
          model.quaternion.setFromRotationMatrix(m);
          model.visible = true;
          arState.current.modelPlaced = true;
          reticle.visible = false;
        } else {
          // If already placed, toggle selection/state if needed (e.g., re-enable reticle to reposition)
          // For now we ignore.
        }
      };
      session.addEventListener("select", onSelect);
      handlersRef.current.onSelect = onSelect;

      // Add touch listeners to canvas for moving/scale/rotate after placed
      const canvas = arState.current.renderer!.domElement;
      canvas.addEventListener("touchstart", handlersRef.current.touchStart, { passive: false });
      canvas.addEventListener("touchmove", handlersRef.current.touchMove, { passive: false });

      // When session ends: cleanup
      const onEnd = () => {
        console.log("XR Session ended.");
        cleanupAfterSession();
      };
      session.addEventListener("end", onEnd);
      handlersRef.current.onEnd = onEnd;
    } catch (err) {
      console.error("Failed to start AR session:", err);
      alert("Unable to start AR session. Make sure you're on a compatible device and use a secure context (https).");
    }
  };

  const cleanupAfterSession = () => {
    // Remove session-specific listeners & reset state
    const canvas = arState.current.renderer?.domElement;
    if (canvas) {
      canvas.removeEventListener("touchstart", handlersRef.current.touchStart);
      canvas.removeEventListener("touchmove", handlersRef.current.touchMove);
    }
    if (arState.current.xrSession) {
      try {
        arState.current.xrSession.removeEventListener("select", handlersRef.current.onSelect);
        arState.current.xrSession.removeEventListener("end", handlersRef.current.onEnd);
      } catch (e) {}
    }
    arState.current.hitTestSource = null;
    arState.current.localRefSpace = null;

    // Hide model and reticle
    if (arState.current.model) {
      arState.current.model.visible = false;
    }
    if (arState.current.reticle) {
      arState.current.reticle.visible = false;
    }
    arState.current.modelPlaced = false;
    setInSession(false);
    arState.current.xrSession = null;
  };

  // End AR session explicitly
  const endAR = async () => {
    if (arState.current.xrSession) {
      await arState.current.xrSession.end();
      // onend will call cleanupAfterSession
    } else {
      cleanupAfterSession();
    }
  };

  // Reset position: hide model and allow re-placement
  const resetPlacement = () => {
    if (arState.current.model) {
      arState.current.model.visible = false;
      arState.current.modelPlaced = false;
    }
    if (arState.current.reticle) {
      arState.current.reticle.visible = true;
    }
  };

  // Capture screenshot of canvas (AR composed view)
  const takeScreenshot = () => {
    const renderer = arState.current.renderer;
    if (!renderer) return alert("Renderer not ready");
    try {
      const dataURL = renderer.domElement.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataURL;
      link.download = "ar_capture.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Screenshot failed:", err);
      alert("Screenshot failed.");
    }
  };

  // UI: Quick Look link for iOS (only show if not supported and iOS)
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as any).MSStream;

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        background: "#000",
      }}
    >
      {/* Top-right status / controls */}
      <div style={{ position: "absolute", top: 12, right: 12, zIndex: 9999, display: "flex", gap: 8 }}>
        {!inSession && (
          <button
            onClick={startAR}
            style={{
              padding: "10px 14px",
              background: "#0b7cff",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 600,
            }}
            title={arSupported ? "Start AR" : "AR may not be supported on this device"}
            disabled={loadingModel}
          >
            {loadingModel ? "Loading model..." : "Start AR"}
          </button>
        )}

        {inSession && (
          <>
            <button
              onClick={takeScreenshot}
              style={{
                padding: "10px 12px",
                background: "#28a745",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Capture Image
            </button>

            <button
              onClick={resetPlacement}
              style={{
                padding: "10px 12px",
                background: "#ffc107",
                color: "black",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Reset Position
            </button>

            <button
              onClick={endAR}
              style={{
                padding: "10px 12px",
                background: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Exit AR
            </button>
          </>
        )}
      </div>

      {/* Instruction overlay bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9999,
          color: "white",
          textAlign: "center",
          backdropFilter: inSession ? "blur(6px)" : "none",
          padding: "10px 14px",
          borderRadius: 8,
          background: inSession ? "rgba(0,0,0,0.35)" : "transparent",
          maxWidth: 480,
        }}
      >
        {!inSession && (
          <div>
            <strong>Preview:</strong>{" "}
            {arSupported
              ? "Tap Start AR to open your camera and place the product."
              : "Your browser/device may not support WebXR. On iOS, use Quick Look below."}
          </div>
        )}
        {inSession && (
          <div>
            <div style={{ marginBottom: 6 }}>
              Tap the screen to place the product. Use one finger to drag, two fingers to scale/rotate.
            </div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>
              After placement you can move/scale/rotate the product before capturing.
            </div>
          </div>
        )}
      </div>

      {/* iOS Quick Look fallback */}
      {!arSupported && isIOS && (
        <a
          href={modelPathUSDZ}
          rel="ar"
          style={{
            display: "inline-block",
            position: "absolute",
            left: 12,
            top: 12,
            zIndex: 9999,
            padding: "8px 12px",
            background: "#28a745",
            color: "white",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          View in Quick Look (iOS)
        </a>
      )}
    </div>
  );
}
