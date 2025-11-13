// pages/ar.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three"; // Use direct import for Three.js
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { ARButton } from "three/examples/jsm/webxr/ARButton.js";

// Optional: for better type safety and if you want to abstract some logic
interface ARState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  reticle: THREE.Mesh | null;
  model: THREE.Object3D | null;
  hitTestSource: XRHitTestSource | null | undefined; // <--- CHANGE THIS LINE
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

  useEffect(() => {
    // Ensure this only runs in the browser
    if (typeof window === "undefined" || !containerRef.current) return;

    let animationFrameId: number;
    const container = containerRef.current;

    async function initAR() {
      // Check for WebXR support
      if ("xr" in navigator && (navigator as any).xr.isSessionSupported) {
        const supported = await (navigator as any).xr.isSessionSupported(
          "immersive-ar"
        );
        setArSupported(supported);
        if (!supported) {
          console.warn("Immersive AR not supported on this device.");
          // You might want to display a message or fallback here
          return;
        }
      } else {
        console.warn("WebXR not available in this browser.");
        return;
      }

      // 1. Scene, Camera, Renderer Setup
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
      ); // Correct camera initialization

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true, // Important for AR to see through
      });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true; // Enable WebXR
      container.appendChild(renderer.domElement);

      arState.current.renderer = renderer;
      arState.current.scene = scene;
      arState.current.camera = camera;

      // 2. Lighting
      const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
      scene.add(light);

      // 3. Reticle (for hit-testing)
      const reticleGeometry = new THREE.RingGeometry(0.07, 0.09, 32).rotateX(
        -Math.PI / 2
      );
      const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const reticle = new THREE.Mesh(reticleGeometry, reticleMaterial);
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      arState.current.reticle = reticle;

      // 4. Load 3D Model
      const loader = new GLTFLoader();
      loader.load(
        "/models/testImage.glb", // Make sure this path is correct relative to 'public' folder
        (gltf) => {
          const model = gltf.scene;
          model.visible = false; // Hidden until placed
          model.scale.set(0.1, 0.1, 0.1); // Adjust initial scale for AR
          scene.add(model);
          arState.current.model = model;
          console.log("Model loaded successfully!");
        },
        undefined, // onProgress
        (error) => {
          console.error("Error loading GLTF model:", error);
          // Fallback or error message for user
        }
      );

      // 5. AR Button and Session Management
     const arButton = ARButton.createButton(renderer, {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay", "dom-overlay-for-handheld-ar"],
        domOverlay: { root: container }, // This is likely the correct direct property
      } as any); // Still cast to 'any' just in case there are other type mismatches
      container.appendChild(arButton);
      // Ensure only one button is created
      const existingArButton = container.querySelector(".ar-button");
      if (existingArButton && existingArButton !== arButton) {
        existingArButton.remove();
      }
      arButton.classList.add("ar-button"); // Add a class for potential styling or removal

      renderer.xr.addEventListener("sessionstart", async (event: any) => {
        arState.current.xrSession = event.session;
        console.log("AR Session Started!");

        const session = arState.current.xrSession!;
        // Request a viewer reference space to get hit test source
        const viewerSpace = await session.requestReferenceSpace("viewer");
        arState.current.hitTestSource = await session.requestHitTestSource({
          space: viewerSpace,
        });
        // Request a local reference space for positioning objects
        arState.current.localRefSpace = await session.requestReferenceSpace(
          "local"
        );

        // Start animation loop once session begins
        renderer.setAnimationLoop(animate);
      });

      renderer.xr.addEventListener("sessionend", () => {
        console.log("AR Session Ended!");
        arState.current.modelPlaced = false;
        if (arState.current.model) arState.current.model.visible = false;
        arState.current.reticle!.visible = false;
        arState.current.hitTestSource = null;
        arState.current.localRefSpace = null;
        arState.current.xrSession = null;
        // Stop animation loop if session ends and no longer needed
        renderer.setAnimationLoop(null);
      });

      // 6. Animation Loop
      const animate = (timestamp: DOMHighResTimeStamp, frame: XRFrame) => {
        if (!frame || !arState.current.xrSession) return;

        const {
          reticle,
          model,
          hitTestSource,
          localRefSpace,
          modelPlaced,
          renderer,
          camera,
        } = arState.current;

        if (model && !modelPlaced && hitTestSource && localRefSpace) {
          const hitTestResults = frame.getHitTestResults(hitTestSource);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(localRefSpace);
            if (pose) {
              reticle!.matrix.fromArray(pose.transform.matrix);
              reticle!.visible = true;
            } else {
              reticle!.visible = false;
            }
          } else {
            reticle!.visible = false;
          }
        }

        renderer!.render(scene, camera!);
      };

      // 7. Touch Events for Model Interaction
      const getTouchPos = (t: Touch) => ({ x: t.clientX, y: t.clientY });
      const distanceBetweenTouches = (t1: Touch, t2: Touch) => {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.hypot(dx, dy);
      };
      const rotationBetweenTouches = (t1: Touch, t2: Touch) => {
        return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX);
      };

      renderer.domElement.addEventListener(
        "touchstart",
        (event: TouchEvent) => {
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
          event.preventDefault(); // Prevent scrolling on iOS
        },
        { passive: false }
      );

      renderer.domElement.addEventListener(
        "touchmove",
        (event: TouchEvent) => {
          if (!arState.current.model || !arState.current.modelPlaced) return;

          event.preventDefault();

          const model = arState.current.model!;
          const renderer = arState.current.renderer!;
          const camera = arState.current.camera!;

          if (event.touches.length === 1) {
            const touch = event.touches[0];
            const currentTouch = getTouchPos(touch);

            // Calculate movement in screen space
            const dx = (currentTouch.x - arState.current.lastSingleTouch.x) / window.innerWidth;
            const dy = (currentTouch.y - arState.current.lastSingleTouch.y) / window.innerHeight;

            // Project screen movement into world space on the plane of the object
            // This is a more intuitive way to drag an object in AR.
            // We'll create a ray from the camera through the touch point
            // and find its intersection with a plane at the object's height.

            const raycaster = new THREE.Raycaster();
            const mouse = new THREE.Vector2();
            mouse.x = (currentTouch.x / window.innerWidth) * 2 - 1;
            mouse.y = -(currentTouch.y / window.innerHeight) * 2 + 1;

            raycaster.setFromCamera(mouse, camera);

            // Create a plane at the model's current y-position
            const plane = new THREE.Plane();
            plane.setFromNormalAndCoplanarPoint(
              new THREE.Vector3(0, 1, 0),
              model.position
            );

            const intersectionPoint = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(plane, intersectionPoint)) {
              // Move the model to the new intersection point
              model.position.x = intersectionPoint.x;
              model.position.z = intersectionPoint.z;
            }

            arState.current.lastSingleTouch = currentTouch;
          } else if (event.touches.length === 2) {
            const d = distanceBetweenTouches(event.touches[0], event.touches[1]);
            const scaleChange = d / arState.current.lastTouchDistance;
            model.scale.multiplyScalar(scaleChange);
            arState.current.lastTouchDistance = d;

            const rot = rotationBetweenTouches(event.touches[0], event.touches[1]);
            const deltaRot = rot - arState.current.lastRotation;
            model.rotateY(deltaRot); // Rotate around the Y-axis (upwards)
            arState.current.lastRotation = rot;
          }
        },
        { passive: false }
      );

      // Tap to place/select
      arState.current.xrSession?.addEventListener("select", () => {
        if (!arState.current.reticle?.visible || !arState.current.model) return;

        if (!arState.current.modelPlaced) {
          arState.current.model.position.setFromMatrixPosition(
            arState.current.reticle.matrix
          );
          // Optional: Orient model to face the camera more naturally
          const m = new THREE.Matrix4().extractRotation(
            arState.current.reticle.matrix
          );
          arState.current.model.quaternion.setFromRotationMatrix(m);
          arState.current.model.visible = true;
          arState.current.modelPlaced = true;
          arState.current.reticle.visible = false; // Hide reticle after placement
        }
      });

      // 8. Screenshot Button
      const screenshotBtn = document.createElement("button");
      screenshotBtn.textContent = "Capture Image";
      Object.assign(screenshotBtn.style, {
        position: "absolute",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: "9999",
        padding: "10px 20px",
        fontSize: "16px",
        backgroundColor: "#007bff",
        color: "white",
        border: "none",
        borderRadius: "5px",
        cursor: "pointer",
        display: "none", // Hide by default, show when AR session is active
      });
      container.appendChild(screenshotBtn);

      renderer.xr.addEventListener("sessionstart", () => {
        screenshotBtn.style.display = "block";
      });
      renderer.xr.addEventListener("sessionend", () => {
        screenshotBtn.style.display = "none";
      });

      screenshotBtn.addEventListener("click", takeScreenshot);

      function takeScreenshot() {
        if (!arState.current.renderer) {
          alert("AR session not active or renderer not ready.");
          return;
        }

        // The simplest way to get a screenshot in WebXR is often to just capture the canvas.
        // Modern WebXR implementations might automatically composite the camera feed.
        try {
          const dataURL = arState.current.renderer.domElement.toDataURL(
            "image/png"
          );
          const link = document.createElement("a");
          link.href = dataURL;
          link.download = "ar_screenshot.png";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (error) {
          console.error("Failed to capture screenshot:", error);
          alert("Failed to capture screenshot. Ensure permissions are granted.");
        }
      }

      // 9. Handle Window Resizing
      const onWindowResize = () => {
        if (arState.current.camera && arState.current.renderer) {
          arState.current.camera.aspect = window.innerWidth / window.innerHeight;
          arState.current.camera.updateProjectionMatrix();
          arState.current.renderer.setSize(window.innerWidth, window.innerHeight);
        }
      };
      window.addEventListener("resize", onWindowResize);

      // Cleanup function
      return () => {
        console.log("Cleaning up AR component.");
        if (arState.current.renderer) {
          arState.current.renderer.setAnimationLoop(null); // Stop animation
          arState.current.renderer.domElement.remove(); // Remove canvas
          arState.current.renderer.dispose(); // Dispose renderer resources
        }
        if (arButton && arButton.parentElement) {
          arButton.parentElement.removeChild(arButton); // Remove AR button
        }
        if (screenshotBtn && screenshotBtn.parentElement) {
          screenshotBtn.parentElement.removeChild(screenshotBtn); // Remove screenshot button
        }
        window.removeEventListener("resize", onWindowResize);
        // Dispose of scene, geometries, materials if necessary (more complex models)
      };
    }

    initAR();
  }, []); // Empty dependency array means this runs once on mount

  // Optional: iOS Quick Look Fallback for unsupported devices or better UX
  const modelViewerRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Check if the device is iOS and AR is not supported by WebXR
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    if (isIOS && !arSupported && modelViewerRef.current) {
      // You would dynamically set the href to your .usdz model here
      modelViewerRef.current.href = "/models/testImage.usdz"; // Ensure you have a .usdz version
      modelViewerRef.current.rel = "ar";
      modelViewerRef.current.style.display = "block"; // Show the link
      modelViewerRef.current.textContent = "View in your space (iOS)";
    }
  }, [arSupported]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden", // Prevent scrollbars
      }}
    >
      <div style={{ position: "absolute", zIndex: 9999, right: 20, top: 20 }}>
        {/* iOS Quick Look Fallback */}
        <a
          id="quicklook-link"
          ref={modelViewerRef}
          style={{
            display: "none",
            padding: "10px 15px",
            backgroundColor: "#28a745",
            color: "white",
            textDecoration: "none",
            borderRadius: "5px",
          }}
        >
          View in Quick Look
        </a>
      </div>
    </div>
  );
}