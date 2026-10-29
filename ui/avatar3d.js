// avatar3d.js - Interactive 3D PS1-Style Anime Avatar Engine using Three.js (r169)
// Provides low-poly geometry, retro pixel-canvas textures, modular hairstyles, outfits,
// fairy wings, accessories, PS1 vertex wobble, atmospheric retro environments, and GLTF export.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
// GLTFExporter is dynamically imported in exportGLB()

export class Avatar3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // PS1 had no anti-aliasing!
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1); // crisp pixel boundaries
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap; // retro hard-edged shadows
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.50, 2.85);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.48, 0);
    this.controls.minDistance = 0.8;
    this.controls.maxDistance = 6.0;

    // Lighting setup
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444455, 1.2);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.dirLight.position.set(2, 4, 3);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(512, 512); // low-res retro shadow map
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 10;
    this.dirLight.shadow.camera.left = -2;
    this.dirLight.shadow.camera.right = 2;
    this.dirLight.shadow.camera.top = 2;
    this.dirLight.shadow.camera.bottom = -1;
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight(0x00f0ff, 1.0);
    this.rimLight.position.set(-3, 2, -2);
    this.scene.add(this.rimLight);

    // Environment & Stage
    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);
    this.particlesGroup = new THREE.Group();
    this.scene.add(this.particlesGroup);

    // Character Root Group
    this.character = new THREE.Group();
    this.scene.add(this.character);

    // State & Config
    this.config = {};
    this.clock = new THREE.Clock();
    this.wobbleEnabled = true;
    this.wireframeMode = false;
    this.animating = true;
    this.particles = [];

    // Setup initial stage
    this._buildStage();
    this.setLighting("cyber_void");

    // Start render loop
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);

    // Resize handling
    this.resize = this.resize.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth || 400;
    const h = parent.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------- Stage & Environment ----------------
  _buildStage() {
    this.stageGroup.clear();

    // Retro pedestal / platform
    const platformGeo = new THREE.CylinderGeometry(1.2, 1.35, 0.12, 16);
    this.platformMat = new THREE.MeshStandardMaterial({
      color: 0x222430,
      roughness: 0.8,
      flatShading: true,
    });
    const platform = new THREE.Mesh(platformGeo, this.platformMat);
    platform.position.y = -0.06;
    platform.receiveShadow = true;
    this.stageGroup.add(platform);

    // Pedestal accent ring
    const ringGeo = new THREE.TorusGeometry(1.22, 0.02, 6, 24);
    ringGeo.rotateX(Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.position.y = 0.01;
    this.stageGroup.add(ring);

    // Road markings for ps1_street environment (matching reference asphalt road & lane dashes)
    this.roadGroup = new THREE.Group();
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8ecf5 });
    for (let i = -2; i <= 2; i++) {
      const dashGeo = new THREE.PlaneGeometry(0.09, 0.36);
      dashGeo.rotateX(-Math.PI / 2);
      dashGeo.rotateY(0.48); // angled dashed lane marking as in the PS1 reference image
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.position.set(-0.45 + i * 0.28, 0.005, -0.6 + i * 0.55);
      this.roadGroup.add(dash);
    }
    this.roadGroup.visible = false;
    this.stageGroup.add(this.roadGroup);

    // Wireframe grid floor
    this.grid = new THREE.GridHelper(12, 24, 0x00f0ff, 0x332255);
    this.grid.position.y = -0.12;
    this.stageGroup.add(this.grid);

    // Ambient floating particles (fairy dust / digital bits)
    this._buildParticles(60);
  }

  _buildParticles(count = 60) {
    this.particlesGroup.clear();
    this.particles = [];
    const geo = new THREE.BoxGeometry(0.025, 0.025, 0.025);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

    for (let i = 0; i < count; i++) {
      const p = new THREE.Mesh(geo, mat.clone());
      p.position.set(
        (Math.random() - 0.5) * 4,
        Math.random() * 2.8,
        (Math.random() - 0.5) * 4
      );
      p.userData = {
        speedY: 0.2 + Math.random() * 0.4,
        rotSpeed: (Math.random() - 0.5) * 3,
        baseY: p.position.y,
        seed: Math.random() * 100,
      };
      this.particlesGroup.add(p);
      this.particles.push(p);
    }
  }

  setLighting(preset) {
    this.config.lighting = preset;
    const p = preset || "cyber_void";

    if (this.roadGroup) {
      this.roadGroup.visible = (p === "ps1_street");
    }

    if (p === "ps1_street") {
      // Muted steel blue-gray background & road atmosphere from reference image
      this.scene.background = new THREE.Color(0x526078);
      this.hemiLight.color.set(0x8e9db3);
      this.hemiLight.groundColor.set(0x282c36);
      this.hemiLight.intensity = 1.1;
      this.dirLight.color.set(0xf0f4fa);
      this.dirLight.intensity = 1.15;
      this.rimLight.color.set(0x65758c);
      this.rimLight.intensity = 0.6;
      this.ringMat.color.set(0x3e4554);
      this.grid.visible = false;
      this.platformMat.color.set(0x282c36); // asphalt road surface
      this._setParticleColor(0x7c8c9f);
    } else if (p === "fairy_garden") {
      this.scene.background = new THREE.Color(0x0e1c18);
      this.hemiLight.color.set(0x76c893);
      this.hemiLight.groundColor.set(0x1a332a);
      this.dirLight.color.set(0xfdf0d5);
      this.dirLight.intensity = 1.4;
      this.rimLight.color.set(0x9d4edd);
      this.ringMat.color.set(0x52b788);
      this.grid.visible = false;
      this.platformMat.color.set(0x1b2820);
      this._setParticleColor(0xc7f9cc);
    } else if (p === "dark_fairy") {
      this.scene.background = new THREE.Color(0x0d0914);
      this.hemiLight.color.set(0x7b2cbf);
      this.hemiLight.groundColor.set(0x10002b);
      this.dirLight.color.set(0xe0aaff);
      this.dirLight.intensity = 1.3;
      this.rimLight.color.set(0xff007f);
      this.ringMat.color.set(0x9d4edd);
      this.grid.visible = true;
      this.grid.material.color.set(0x5a189a);
      this.platformMat.color.set(0x1a1224);
      this._setParticleColor(0xe0aaff);
    } else if (p === "ps1_bios") {
      this.scene.background = new THREE.Color(0x0a1128);
      this.hemiLight.color.set(0x48cae4);
      this.hemiLight.groundColor.set(0x001845);
      this.dirLight.color.set(0xfff3b0);
      this.dirLight.intensity = 1.3;
      this.rimLight.color.set(0xffd166);
      this.ringMat.color.set(0xffd166);
      this.grid.visible = true;
      this.grid.material.color.set(0x1d3557);
      this.platformMat.color.set(0x0c1b33);
      this._setParticleColor(0xfff3b0);
    } else if (p === "grunge_room") {
      this.scene.background = new THREE.Color(0x161413);
      this.hemiLight.color.set(0xd4a373);
      this.hemiLight.groundColor.set(0x281e19);
      this.dirLight.color.set(0xfaedcd);
      this.dirLight.intensity = 1.5;
      this.rimLight.color.set(0x936639);
      this.ringMat.color.set(0xbc6c25);
      this.grid.visible = false;
      this.platformMat.color.set(0x28231d);
      this._setParticleColor(0xd4a373);
    } else {
      // cyber_void default
      this.scene.background = new THREE.Color(0x10101a);
      this.hemiLight.color.set(0x00f0ff);
      this.hemiLight.groundColor.set(0x280b3d);
      this.dirLight.color.set(0xffffff);
      this.dirLight.intensity = 1.5;
      this.rimLight.color.set(0xff00aa);
      this.ringMat.color.set(0x00f0ff);
      this.grid.visible = true;
      this.grid.material.color.set(0x4b1d6d);
      this.platformMat.color.set(0x1c172b);
      this._setParticleColor(0x00f0ff);
    }
  }

  _setParticleColor(hex) {
    const col = new THREE.Color(hex);
    for (const p of this.particles) {
      p.material.color.copy(col);
    }
  }

  // ---------------- Camera View Presets ----------------
  setView(preset) {
    const duration = 0.5;
    const target = new THREE.Vector3(0, 0.5, 0);

    if (preset === "face") {
      this._tweenCamera(0, 0.85, 1.4, 0, 0.85, 0);
    } else if (preset === "side") {
      this._tweenCamera(2.8, 0.5, 0, 0, 0.5, 0);
    } else if (preset === "back") {
      this._tweenCamera(0, 0.6, -3.0, 0, 0.5, 0);
    } else if (preset === "angle") {
      this._tweenCamera(1.5, 0.6, 2.5, 0, 0.5, 0);
    } else {
      // front
      this._tweenCamera(0, 0.50, 2.85, 0, 0.48, 0);
    }
  }

  _tweenCamera(x, y, z, tx, ty, tz) {
    this.camera.position.set(x, y, z);
    this.controls.target.set(tx, ty, tz);
    this.controls.update();
  }

  resetCamera() {
    this.setView("front");
  }

  // ---------------- Texture Generation (Pixel Canvas) ----------------
  _createEyeTexture(eyeColorHex = "#00f0ff", style = "sparkle") {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false; // pixel art look

    // Eye white base
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(64, 64, 52, 44, 0, 0, Math.PI * 2);
    ctx.fill();

    // Top eyelid shadow
    ctx.fillStyle = "#ccd0e0";
    ctx.beginPath();
    ctx.ellipse(64, 38, 50, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Iris
    ctx.fillStyle = eyeColorHex;
    ctx.beginPath();
    ctx.ellipse(64, 66, 34, 34, 0, 0, Math.PI * 2);
    ctx.fill();

    // Inner Iris Gradient / Darker upper half
    ctx.fillStyle = "#111122";
    ctx.beginPath();
    ctx.ellipse(64, 66, 18, 18, 0, 0, Math.PI * 2);
    ctx.fill();

    // Specular Anime Highlights
    if (style === "sparkle") {
      // Large top-left highlight
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(52, 54, 10, 8, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      // Little bottom-right twinkle
      ctx.beginPath();
      ctx.arc(76, 78, 5, 0, Math.PI * 2);
      ctx.fill();
      // Star glint in center
      ctx.fillStyle = "#aaffff";
      ctx.fillRect(63, 62, 3, 9);
      ctx.fillRect(60, 65, 9, 3);
    } else if (style === "sleepy_grunge" || style === "sleepy_goth") {
      // Sleepy half-lidded rectangular/almond shape with clumped lower lash spikes (image match)
      // Droopy dark eyelid shadow covering upper half
      ctx.fillStyle = "#18141d";
      ctx.fillRect(16, 20, 96, 32);
      ctx.fillRect(12, 48, 104, 8);

      // Dark iris / pupil partially covered by the droopy lid
      ctx.fillStyle = eyeColorHex || "#14151b";
      ctx.beginPath();
      ctx.ellipse(64, 72, 26, 26, 0, 0, Math.PI * 2);
      ctx.fill();

      // Deep black pupil
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.ellipse(64, 72, 14, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // Subtle anime highlight glint
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(54, 64, 6, 6);

      // Distinct spiky clumped LOWER eyelashes - matching reference picture!
      ctx.fillStyle = "#18141d";
      const spikes = [
        { x: 30, y: 92, w: 9, h: 20, angle: -0.25 },
        { x: 48, y: 96, w: 10, h: 24, angle: -0.06 },
        { x: 68, y: 96, w: 10, h: 24, angle: 0.06 },
        { x: 88, y: 92, w: 9, h: 20, angle: 0.25 },
      ];
      spikes.forEach((s) => {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.beginPath();
        ctx.moveTo(-s.w / 2, 0);
        ctx.lineTo(s.w / 2, 0);
        ctx.lineTo(0, s.h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    } else if (style === "grunge_dark") {
      // Narrowed, sleepy grunge pupil
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(54, 56, 5, 0, Math.PI * 2);
      ctx.fill();
      // Heavy dark upper rim
      ctx.fillStyle = "#050508";
      ctx.fillRect(20, 20, 88, 16);
    } else if (style === "fairy_mystic") {
      // Concentric enchanted rings
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(64, 66, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(54, 52, 7, 0, Math.PI * 2);
      ctx.arc(74, 56, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // retro_game: classic 8-bit / 16-bit blocky highlights
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(48, 50, 12, 12);
      ctx.fillRect(72, 72, 6, 6);
    }

    // Heavy anime eyeliner & lashes
    ctx.fillStyle = "#18141d";
    ctx.beginPath();
    ctx.moveTo(12, 50);
    ctx.quadraticCurveTo(64, 14, 116, 46);
    ctx.lineTo(110, 56);
    ctx.quadraticCurveTo(64, 28, 18, 58);
    ctx.closePath();
    ctx.fill();

    // Outer lash wing
    ctx.beginPath();
    ctx.moveTo(106, 44);
    ctx.lineTo(124, 34);
    ctx.lineTo(112, 52);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _createFaceTexture(skinHex = "#f5d0c5", makeupList = []) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // Base skin
    ctx.fillStyle = skinHex;
    ctx.fillRect(0, 0, 256, 256);

    const hasMakeup = (item) => Array.isArray(makeupList) && makeupList.includes(item);

    // Blush
    if (hasMakeup("blush")) {
      ctx.fillStyle = "rgba(255, 100, 130, 0.35)";
      ctx.beginPath();
      ctx.ellipse(65, 145, 32, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(191, 145, 32, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // Anime cheek blush lines
      ctx.strokeStyle = "rgba(220, 60, 90, 0.4)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(52 + i * 10, 152); ctx.lineTo(60 + i * 10, 138); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(178 + i * 10, 152); ctx.lineTo(186 + i * 10, 138); ctx.stroke();
      }
    }

    // Freckles
    if (hasMakeup("freckles")) {
      ctx.fillStyle = "rgba(130, 70, 50, 0.65)";
      const spots = [
        [75, 142], [88, 146], [105, 148], [128, 149], [151, 148], [168, 146], [181, 142],
        [80, 149], [98, 153], [120, 154], [136, 154], [158, 153], [176, 149],
      ];
      for (const [x, y] of spots) {
        ctx.fillRect(x, y, 3, 3);
      }
    }

    // Lips / Lipstick
    if (hasMakeup("dark_lips")) {
      ctx.fillStyle = "#2b091f"; // gothic dark berry
      ctx.beginPath();
      ctx.ellipse(128, 195, 20, 8, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Natural soft anime lip
      ctx.fillStyle = "rgba(220, 110, 120, 0.55)";
      ctx.beginPath();
      ctx.ellipse(128, 195, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cyber markings
    if (hasMakeup("cyber_markings")) {
      ctx.fillStyle = "#00f0ff";
      // Under-eye cyber dots & tech lines
      ctx.fillRect(55, 165, 4, 4);
      ctx.fillRect(65, 165, 4, 4);
      ctx.fillRect(75, 165, 18, 3);
      ctx.fillRect(197, 165, 4, 4);
      ctx.fillRect(187, 165, 4, 4);
      ctx.fillRect(163, 165, 18, 3);
    }

    // Fairy glitter / tear decal
    if (hasMakeup("fairy_glitter")) {
      ctx.fillStyle = "#ffffff";
      // Little diamond glints under eyes
      this._drawDiamond(ctx, 80, 162, 5);
      this._drawDiamond(ctx, 176, 162, 5);
      ctx.fillStyle = "#ffbbee";
      this._drawDiamond(ctx, 88, 168, 3);
      this._drawDiamond(ctx, 168, 168, 3);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _drawDiamond(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.7, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.7, cy);
    ctx.closePath();
    ctx.fill();
  }

  _createStripedTexture(baseHex, stripeHex, count = 8) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 64, 64);

    ctx.fillStyle = stripeHex;
    const step = 64 / count;
    for (let i = 0; i < count; i += 2) {
      ctx.fillRect(0, i * step, 64, step);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = false;
    return tex;
  }

  _createPlaidTexture(col1, col2, col3) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = col1;
    ctx.fillRect(0, 0, 64, 64);

    ctx.fillStyle = col2;
    ctx.fillRect(0, 8, 64, 16);
    ctx.fillRect(0, 40, 64, 16);
    ctx.fillRect(8, 0, 16, 64);
    ctx.fillRect(40, 0, 16, 64);

    ctx.fillStyle = col3;
    ctx.fillRect(0, 20, 64, 4);
    ctx.fillRect(20, 0, 4, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 2);
    tex.generateMipmaps = false;
    return tex;
  }

  _createFloralTopTexture(baseHex = "#c5aee0", accentHex = "#6e3d5c") {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const bColor = baseHex.startsWith("#") ? baseHex : `#${baseHex}`;
    const aColor = accentHex.startsWith("#") ? accentHex : `#${accentHex}`;

    // Base lilac fabric
    ctx.fillStyle = bColor;
    ctx.fillRect(0, 0, 128, 128);

    // Accent frill borders (top & bottom hem)
    ctx.fillStyle = aColor;
    ctx.fillRect(0, 0, 128, 6);
    ctx.fillRect(0, 122, 128, 6);

    // Cute scattered floral petals/blossoms
    const flowers = [
      { x: 32, y: 45, r: 10 },
      { x: 64, y: 72, r: 12 },
      { x: 96, y: 45, r: 10 },
      { x: 64, y: 30, r: 8 },
      { x: 36, y: 95, r: 7 },
      { x: 92, y: 95, r: 7 },
    ];
    flowers.forEach((fl) => {
      ctx.fillStyle = aColor;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2;
        const px = fl.x + Math.cos(ang) * (fl.r * 0.7);
        const py = fl.y + Math.sin(ang) * (fl.r * 0.7);
        ctx.beginPath();
        ctx.arc(px, py, fl.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(fl.x, fl.y, fl.r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    });

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ---------------- Model Assembly ----------------
  loadAvatar(config) {
    this.config = { ...config };
    this.character.clear();

    const skinColor = new THREE.Color(this.config.skin_tone || "#f5d0c5");
    const hairColor = new THREE.Color(this.config.hair_color || "#ff77aa");
    const eyeColor = this.config.eye_color || "#00f0ff";
    const topColor = new THREE.Color(this.config.top_color || "#1a1a2e");
    const topAccent = new THREE.Color(this.config.top_accent || "#00f0ff");
    const bottomColor = new THREE.Color(this.config.bottom_color || "#2d1b4e");
    const shoesColor = new THREE.Color(this.config.shoes_color || "#ffffff");
    const shoesAccent = new THREE.Color(this.config.shoes_accent || "#00f0ff");
    const jewelryColor = new THREE.Color(this.config.jewelry_color || "#c0c0c0");

    // Common materials
    this.skinMat = new THREE.MeshStandardMaterial({
      color: skinColor,
      map: this._createFaceTexture(this.config.skin_tone, this.config.makeup),
      roughness: 0.85,
      metalness: 0.05,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    this.hairMat = new THREE.MeshStandardMaterial({
      color: hairColor,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    this.jewelryMat = new THREE.MeshStandardMaterial({
      color: jewelryColor,
      metalness: 0.9,
      roughness: 0.3,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    // 1. Build Head Group
    this.headGroup = new THREE.Group();
    this.headGroup.position.set(0, 0.92, 0);

    // Faceted low-poly anime head
    const headGeo = new THREE.DodecahedronGeometry(0.24, 1);
    headGeo.scale(0.85, 1.05, 0.9);
    const headMesh = new THREE.Mesh(headGeo, this.skinMat);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    this.headGroup.add(headMesh);

    // Stylized Anime Nose
    const noseGeo = new THREE.ConeGeometry(0.025, 0.06, 4);
    noseGeo.rotateX(Math.PI / 2);
    const noseMesh = new THREE.Mesh(noseGeo, this.skinMat);
    noseMesh.position.set(0, 0, 0.22);
    this.headGroup.add(noseMesh);

    // Low-poly Ears
    const earGeo = new THREE.ConeGeometry(0.04, 0.1, 4);
    earGeo.rotateZ(Math.PI / 2.4);
    const leftEar = new THREE.Mesh(earGeo, this.skinMat);
    leftEar.position.set(-0.21, 0.02, -0.02);
    const rightEar = leftEar.clone();
    rightEar.scale.set(-1, 1, 1);
    rightEar.position.set(0.21, 0.02, -0.02);
    this.headGroup.add(leftEar, rightEar);

    // Anime Eyes (Decal planes)
    const eyeMat = new THREE.MeshBasicMaterial({
      map: this._createEyeTexture(eyeColor, this.config.eye_style),
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
    });
    const leftEye = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), eyeMat);
    leftEye.position.set(-0.082, 0.025, 0.215);
    leftEye.rotation.y = -0.15;
    leftEye.rotation.x = -0.05;

    const rightEye = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), eyeMat);
    rightEye.position.set(0.082, 0.025, 0.215);
    rightEye.rotation.y = 0.15;
    rightEye.rotation.x = -0.05;
    this.headGroup.add(leftEye, rightEye);

    // 2. Build Selected Hairstyle
    this.hairGroup = this._buildHair(this.config.hair_style || "pigtails");
    this.headGroup.add(this.hairGroup);

    // 3. Hair Accessories
    this.accessoriesGroup = new THREE.Group();
    const accList = this.config.accessories || [];
    if (accList.includes("butterfly_clips")) {
      this._addButterflyClips(this.accessoriesGroup);
    }
    if (accList.includes("star_pins")) {
      this._addStarPins(this.accessoriesGroup);
    }
    if (accList.includes("headphones")) {
      this._addHeadphones(this.accessoriesGroup);
    }
    this.headGroup.add(this.accessoriesGroup);
    this.character.add(this.headGroup);

    // 4. Body (Neck, Torso, Arms, Legs) - Slender anime silhouette
    this.bodyGroup = new THREE.Group();

    // Delicate anime neck
    const neckGeo = new THREE.CylinderGeometry(0.046, 0.054, 0.15, 6);
    const neckMesh = new THREE.Mesh(neckGeo, this.skinMat);
    neckMesh.position.set(0, 0.81, 0);
    this.bodyGroup.add(neckMesh);

    // Choker / Necklace
    if (accList.includes("choker")) {
      const chokerGeo = new THREE.TorusGeometry(0.052, 0.012, 6, 12);
      chokerGeo.rotateX(Math.PI / 2);
      const chokerMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
      const choker = new THREE.Mesh(chokerGeo, chokerMat);
      choker.position.set(0, 0.81, 0);

      // Silver padlock or cross charm
      const charmGeo = new THREE.BoxGeometry(0.024, 0.032, 0.012);
      const charm = new THREE.Mesh(charmGeo, this.jewelryMat);
      charm.position.set(0, 0.79, 0.065);
      this.bodyGroup.add(choker, charm);
    }

    // Top / Shirt / Jacket
    this.topMesh = this._buildTop(this.config.top || "track_jacket", topColor, topAccent);
    this.bodyGroup.add(this.topMesh);

    // Arms
    this.armsGroup = this._buildArms(this.config.top, topColor, topAccent, skinColor);
    this.bodyGroup.add(this.armsGroup);

    // Bottom / Skirt / Pants
    this.bottomMesh = this._buildBottom(this.config.bottom || "pleated_skirt", bottomColor, topAccent);
    this.bodyGroup.add(this.bottomMesh);

    // Chain Belt
    if (accList.includes("chain_belt")) {
      this._addChainBelt(this.bodyGroup);
    }

    // Golden Spear on Back (Picture Match) - Mounted behind slender back
    if (accList.includes("golden_spear")) {
      const spearGroup = new THREE.Group();
      spearGroup.position.set(-0.04, 0.44, -0.11);
      spearGroup.rotation.z = -0.30;
      spearGroup.rotation.x = -0.10;

      // Shaft (weathered dark wood)
      const shaftGeo = new THREE.CylinderGeometry(0.012, 0.014, 1.7, 6);
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x3d281a, roughness: 0.85, flatShading: true });
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.y = 0.45;
      spearGroup.add(shaft);

      // Glowing golden spearhead (matching image)
      const bladeGeo = new THREE.ConeGeometry(0.062, 0.35, 4);
      bladeGeo.scale(1.15, 1.0, 0.45); // flat diamond spear blade
      const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xffe240,
        emissive: 0xffd000,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.4,
        flatShading: true,
      });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 1.38;
      spearGroup.add(blade);

      // Gold collar / guard
      const guardGeo = new THREE.CylinderGeometry(0.030, 0.022, 0.05, 6);
      const guardMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8, flatShading: true });
      const guard = new THREE.Mesh(guardGeo, guardMat);
      guard.position.y = 1.20;
      spearGroup.add(guard);

      this.bodyGroup.add(spearGroup);
    }

    // Legs & Shoes
    this.legsGroup = this._buildLegsAndShoes(this.config.shoes || "cyber_sneakers", shoesColor, shoesAccent, skinColor);
    this.bodyGroup.add(this.legsGroup);

    // Fairy Wings
    if (this.config.wings) {
      this.wingsGroup = this._buildWings(this.config.wing_style || "cyber_wings", this.config.wing_color || "#00ffee");
      this.wingsGroup.position.set(0, 0.65, -0.16);
      this.bodyGroup.add(this.wingsGroup);
    } else {
      this.wingsGroup = null;
    }

    this.character.add(this.bodyGroup);

    // Position whole character nicely on pedestal
    this.character.position.set(0, 0.05, 0);

    // Set Lighting preset
    if (this.config.lighting) {
      this.setLighting(this.config.lighting);
    }

    // Toggle wobble based on config
    this.wobbleEnabled = this.config.wobble !== false;
  }

  // ---------------- Hairstyle Generators ----------------
  _buildHair(style) {
    const g = new THREE.Group();

    // Base Skull Cap
    const capGeo = new THREE.SphereGeometry(0.25, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.7);
    const cap = new THREE.Mesh(capGeo, this.hairMat);
    cap.position.set(0, 0.06, 0);
    g.add(cap);

    if (style === "cat_wolf_cut" || style === "neko_wolf_cut") {
      // Shaggy dark wolf cut + cat ears + long front framing locks (picture match)
      this._addWolfLayers(g);
      this._addAnimeBangs(g, "choppy");
      this._addCatEars(g);
    } else if (style === "pigtails") {
      // Y2K Spiky Twin Tails
      this._addSpikyPigtail(g, -0.22, 0.16, -0.05, -1);
      this._addSpikyPigtail(g, 0.22, 0.16, -0.05, 1);
      // Front framing bangs
      this._addAnimeBangs(g, "twin_fringe");
    } else if (style === "wolf_cut") {
      // Shaggy layered wolf cut
      this._addWolfLayers(g);
      this._addAnimeBangs(g, "choppy");
    } else if (style === "hime_cut") {
      // Long sleek back + blunt side sidelocks
      this._addHimeCut(g);
      this._addAnimeBangs(g, "straight");
    } else if (style === "twin_buns") {
      // Cyber Space Buns
      this._addSpaceBun(g, -0.2, 0.26, -0.05);
      this._addSpaceBun(g, 0.2, 0.26, -0.05);
      this._addAnimeBangs(g, "curtain");
    } else if (style === "messy_bob") {
      // 90s Grunge Bob
      this._addMessyBob(g);
      this._addAnimeBangs(g, "side_swept");
    } else if (style === "fairy_locs") {
      // Fairy Locs / Braids with beads
      this._addFairyLocs(g);
      this._addAnimeBangs(g, "wispy");
    } else {
      // short_spiky
      this._addSpikyTop(g);
      this._addAnimeBangs(g, "spiky");
    }

    return g;
  }

  _addCatEars(parent) {
    const earGroup = new THREE.Group();

    // Cat ears positioned on top of the head (tilted slightly outward)
    const ears = [
      { x: -0.15, y: 0.26, z: 0.02, rotZ: -0.28, rotX: -0.08 },
      { x: 0.15, y: 0.26, z: 0.02, rotZ: 0.28, rotX: -0.08 },
    ];
    ears.forEach((pos) => {
      const ear = new THREE.Group();
      ear.position.set(pos.x, pos.y, pos.z);
      ear.rotation.z = pos.rotZ;
      ear.rotation.x = pos.rotX;

      // Outer ear: 4-sided faceted cone
      const outerGeo = new THREE.ConeGeometry(0.075, 0.16, 4);
      outerGeo.translate(0, 0.08, 0);
      const outer = new THREE.Mesh(outerGeo, this.hairMat);
      ear.add(outer);

      // Inner ear fluff/shadow
      const innerGeo = new THREE.ConeGeometry(0.048, 0.12, 3);
      innerGeo.translate(0, 0.06, 0.018);
      const innerMat = new THREE.MeshStandardMaterial({
        color: 0x22222a,
        roughness: 0.9,
        flatShading: true,
      });
      const inner = new THREE.Mesh(innerGeo, innerMat);
      ear.add(inner);

      // Cute base hair tufts around ear root
      const tuftGeo = new THREE.ConeGeometry(0.035, 0.09, 3);
      tuftGeo.translate(0, 0.045, 0);
      const tuft = new THREE.Mesh(tuftGeo, this.hairMat);
      tuft.position.set(pos.x > 0 ? 0.04 : -0.04, 0.01, 0.02);
      tuft.rotation.z = pos.x > 0 ? 0.45 : -0.45;
      ear.add(tuft);

      earGroup.add(ear);
    });

    // Front long face-framing shaggy locks extending over shoulders down to chest
    const longLockGeo = new THREE.ConeGeometry(0.040, 0.60, 4);
    longLockGeo.translate(0, -0.30, 0);

    const leftLock = new THREE.Mesh(longLockGeo, this.hairMat);
    leftLock.position.set(-0.13, 0.08, 0.14);
    leftLock.rotation.z = 0.12;
    leftLock.rotation.x = 0.12;

    const rightLock = new THREE.Mesh(longLockGeo, this.hairMat);
    rightLock.position.set(0.13, 0.08, 0.14);
    rightLock.rotation.z = -0.12;
    rightLock.rotation.x = 0.12;

    earGroup.add(leftLock, rightLock);
    parent.add(earGroup);
  }

  _addSpikyPigtail(parent, x, y, z, dir = 1) {
    const p = new THREE.Group();
    p.position.set(x, y, z);
    // Scrunchie ring
    const scrunchie = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.02, 6, 8),
      this.jewelryMat
    );
    scrunchie.rotation.x = Math.PI / 4;
    p.add(scrunchie);

    // Multi-chunk spiky pigtail strands
    const lengths = [0.45, 0.52, 0.38, 0.3];
    lengths.forEach((len, idx) => {
      const strandGeo = new THREE.ConeGeometry(0.055 - idx * 0.01, len, 5);
      strandGeo.translate(0, -len / 2, 0);
      const strand = new THREE.Mesh(strandGeo, this.hairMat);
      strand.rotation.z = (dir * (0.2 + idx * 0.12));
      strand.rotation.x = (idx * 0.1 - 0.15);
      p.add(strand);
    });

    parent.add(p);
  }

  _addSpaceBun(parent, x, y, z) {
    const bunGeo = new THREE.DodecahedronGeometry(0.12, 1);
    const bun = new THREE.Mesh(bunGeo, this.hairMat);
    bun.position.set(x, y, z);

    // Metallic hair ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.015, 6, 12),
      this.jewelryMat
    );
    ring.rotation.x = Math.PI / 2;
    bun.add(ring);

    // Little bun tendril
    const tendrilGeo = new THREE.ConeGeometry(0.03, 0.22, 4);
    tendrilGeo.translate(0, -0.11, 0);
    const tendril = new THREE.Mesh(tendrilGeo, this.hairMat);
    tendril.position.set(0, -0.06, 0.04);
    tendril.rotation.z = (x > 0 ? 0.3 : -0.3);
    bun.add(tendril);

    parent.add(bun);
  }

  _addAnimeBangs(parent, type) {
    const g = new THREE.Group();
    const count = type === "straight" ? 6 : 5;
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1) - 0.5) * 2; // -1 to 1
      const bangGeo = new THREE.ConeGeometry(0.045, 0.22 - Math.abs(t) * 0.05, 4);
      bangGeo.translate(0, -0.11, 0);
      const b = new THREE.Mesh(bangGeo, this.hairMat);
      b.position.set(t * 0.14, 0.18, 0.18 + (1 - Math.abs(t)) * 0.04);
      b.rotation.z = -t * 0.25;
      b.rotation.x = 0.2;
      g.add(b);
    }

    // Side face-framing tendrils
    const sideGeo = new THREE.ConeGeometry(0.05, 0.45, 4);
    sideGeo.translate(0, -0.225, 0);
    const leftSide = new THREE.Mesh(sideGeo, this.hairMat);
    leftSide.position.set(-0.21, 0.12, 0.12);
    leftSide.rotation.z = 0.15;
    const rightSide = new THREE.Mesh(sideGeo, this.hairMat);
    rightSide.position.set(0.21, 0.12, 0.12);
    rightSide.rotation.z = -0.15;
    g.add(leftSide, rightSide);

    parent.add(g);
  }

  _addWolfLayers(parent) {
    const g = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 1.5 + Math.PI * 0.75;
      const len = 0.35 + (i % 3) * 0.08;
      const geo = new THREE.ConeGeometry(0.06, len, 4);
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, this.hairMat);
      m.position.set(Math.cos(angle) * 0.22, 0.1 - (i % 3) * 0.04, Math.sin(angle) * 0.22);
      m.rotation.y = -angle;
      m.rotation.z = (Math.random() - 0.5) * 0.4;
      m.rotation.x = 0.3;
      g.add(m);
    }
    parent.add(g);
  }

  _addHimeCut(parent) {
    const g = new THREE.Group();
    // Long back curtain
    const backGeo = new THREE.BoxGeometry(0.38, 0.7, 0.08);
    backGeo.translate(0, -0.35, 0);
    const back = new THREE.Mesh(backGeo, this.hairMat);
    back.position.set(0, 0.12, -0.18);
    g.add(back);

    // Sharp blunt sidelocks
    const sideGeo = new THREE.BoxGeometry(0.06, 0.4, 0.05);
    sideGeo.translate(0, -0.2, 0);
    const leftLock = new THREE.Mesh(sideGeo, this.hairMat);
    leftLock.position.set(-0.21, 0.1, 0.08);
    const rightLock = new THREE.Mesh(sideGeo, this.hairMat);
    rightLock.position.set(0.21, 0.1, 0.08);
    g.add(leftLock, rightLock);

    parent.add(g);
  }

  _addMessyBob(parent) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 1.4 + Math.PI * 0.8;
      const len = 0.32 + Math.random() * 0.08;
      const geo = new THREE.ConeGeometry(0.065, len, 4);
      geo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(geo, this.hairMat);
      m.position.set(Math.cos(a) * 0.21, 0.08, Math.sin(a) * 0.21);
      m.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(m);
    }
    parent.add(g);
  }

  _addFairyLocs(parent) {
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 1.5 + Math.PI * 0.75;
      const len = 0.65 + (i % 2) * 0.1;
      const locGeo = new THREE.CylinderGeometry(0.02, 0.028, len, 5);
      locGeo.translate(0, -len / 2, 0);
      const m = new THREE.Mesh(locGeo, this.hairMat);
      m.position.set(Math.cos(a) * 0.22, 0.08, Math.sin(a) * 0.22);
      m.rotation.z = (Math.random() - 0.5) * 0.25;

      // Metallic bead accent on loc
      if (i % 3 === 0) {
        const bead = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6),
          this.jewelryMat
        );
        bead.position.y = -0.25 - (i % 2) * 0.1;
        m.add(bead);
      }
      g.add(m);
    }
    parent.add(g);
  }

  _addSpikyTop(parent) {
    const g = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const len = 0.2 + (i % 3) * 0.06;
      const geo = new THREE.ConeGeometry(0.06, len, 4);
      geo.translate(0, len / 2, 0);
      const m = new THREE.Mesh(geo, this.hairMat);
      m.position.set(Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14);
      m.rotation.x = Math.sin(a) * 0.4;
      m.rotation.z = -Math.cos(a) * 0.4;
      g.add(m);
    }
    parent.add(g);
  }

  // ---------------- Hair Accessories ----------------
  _addButterflyClips(parent) {
    const colors = [0xff69b4, 0x00f0ff, 0xa06cd5];
    const positions = [
      [-0.18, 0.2, 0.16, 0.3],
      [0.18, 0.22, 0.15, -0.3],
      [-0.14, 0.3, 0.08, 0.6],
    ];

    positions.forEach(([x, y, z, rot], idx) => {
      const b = new THREE.Group();
      b.position.set(x, y, z);
      b.rotation.z = rot;

      const wingMat = new THREE.MeshStandardMaterial({
        color: colors[idx % colors.length],
        roughness: 0.4,
        metalness: 0.2,
        side: THREE.DoubleSide,
      });

      // Butterfly wings
      const wGeo = new THREE.BufferGeometry();
      const vertices = new Float32Array([
        0, 0, 0,  -0.035, 0.03, 0,  -0.03, -0.015, 0,
        0, 0, 0,   0.035, 0.03, 0,   0.03, -0.015, 0,
      ]);
      wGeo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      wGeo.computeVertexNormals();

      const wings = new THREE.Mesh(wGeo, wingMat);
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, 0.03, 4),
        this.jewelryMat
      );
      b.add(wings, body);
      parent.add(b);
    });
  }

  _addStarPins(parent) {
    const starShape = new THREE.Shape();
    const pts = 5;
    for (let i = 0; i < pts * 2; i++) {
      const r = i % 2 === 0 ? 0.028 : 0.012;
      const a = (i / (pts * 2)) * Math.PI * 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) starShape.moveTo(px, py);
      else starShape.lineTo(px, py);
    }
    const starGeo = new THREE.ShapeGeometry(starShape);

    const s1 = new THREE.Mesh(starGeo, this.jewelryMat);
    s1.position.set(-0.16, 0.24, 0.16);
    s1.rotation.y = -0.3;

    const s2 = new THREE.Mesh(starGeo, this.jewelryMat);
    s2.position.set(-0.21, 0.17, 0.14);
    s2.rotation.y = -0.4;
    s2.scale.set(0.7, 0.7, 0.7);

    parent.add(s1, s2);
  }

  _addHeadphones(parent) {
    const hp = new THREE.Group();
    // Headband arc
    const bandGeo = new THREE.TorusGeometry(0.24, 0.018, 6, 16, Math.PI);
    const band = new THREE.Mesh(bandGeo, this.jewelryMat);
    band.position.set(0, 0.06, 0);
    hp.add(band);

    // Ear cups
    const cupGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.05, 8);
    cupGeo.rotateZ(Math.PI / 2);
    const foamMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.9 });

    const leftCup = new THREE.Mesh(cupGeo, foamMat);
    leftCup.position.set(-0.24, 0.04, 0);
    const rightCup = leftCup.clone();
    rightCup.position.set(0.24, 0.04, 0);

    // Chrome outer disc
    const discGeo = new THREE.CircleGeometry(0.07, 8);
    discGeo.rotateY(Math.PI / 2);
    const leftDisc = new THREE.Mesh(discGeo, this.jewelryMat);
    leftDisc.position.set(-0.266, 0.04, 0);
    const rightDisc = new THREE.Mesh(discGeo, this.jewelryMat);
    rightDisc.position.set(0.266, 0.04, 0);

    hp.add(leftCup, rightCup, leftDisc, rightDisc);
    parent.add(hp);
  }

  // ---------------- Clothing Tops ----------------
  _buildTop(type, mainColor, accentColor) {
    const g = new THREE.Group();
    let mat = new THREE.MeshStandardMaterial({
      color: mainColor,
      roughness: 0.8,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    if (type === "asym_bell_sleeve") {
      // Cropped lilac top with floral Sakura decals & ruffled hem (picture match) - Slender anime torso
      const topTex = this._createFloralTopTexture(
        mainColor.getHexString(),
        accentColor.getHexString()
      );
      const floralMat = new THREE.MeshStandardMaterial({
        color: mainColor,
        map: topTex,
        roughness: 0.8,
        flatShading: true,
        wireframe: this.wireframeMode,
      });

      // Cropped fitted slender bodice
      const cropGeo = new THREE.CylinderGeometry(0.125, 0.108, 0.23, 8);
      const crop = new THREE.Mesh(cropGeo, floralMat);
      crop.position.set(0, 0.66, 0);

      // Frilly / ruffled wavy trim at the bottom hem
      const ruffleGeo = new THREE.TorusGeometry(0.11, 0.012, 6, 12);
      ruffleGeo.rotateX(Math.PI / 2);
      const ruffleMat = new THREE.MeshStandardMaterial({
        color: accentColor,
        roughness: 0.7,
        flatShading: true,
      });
      const ruffle = new THREE.Mesh(ruffleGeo, ruffleMat);
      ruffle.position.set(0, 0.545, 0);

      // Exposed slender midriff / narrow waist flaring gently to hips
      const midriffGeo = new THREE.CylinderGeometry(0.102, 0.122, 0.16, 8);
      const midriff = new THREE.Mesh(midriffGeo, this.skinMat);
      midriff.position.set(0, 0.465, 0);

      // Navel / belly button detail
      const navelGeo = new THREE.SphereGeometry(0.007, 4, 4);
      const navelMat = new THREE.MeshBasicMaterial({ color: 0x4a2e22 });
      const navel = new THREE.Mesh(navelGeo, navelMat);
      navel.position.set(0, 0.45, 0.124);

      g.add(crop, ruffle, midriff, navel);
    } else if (type === "oversized_tee") {
      // Slender oversized tee (relaxed drape without bulk)
      const teeGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.46, 8);
      const tee = new THREE.Mesh(teeGeo, mat);
      tee.position.set(0, 0.54, 0);
      tee.castShadow = true;
      tee.receiveShadow = true;

      // Y2K Graphic on chest
      const graphicGeo = new THREE.PlaneGeometry(0.12, 0.12);
      const graphicMat = new THREE.MeshBasicMaterial({
        color: accentColor,
        side: THREE.DoubleSide,
      });
      const graphic = new THREE.Mesh(graphicGeo, graphicMat);
      graphic.position.set(0, 0.58, 0.17);
      g.add(tee, graphic);
    } else if (type === "layered_baby_tee") {
      // Cropped fitted baby tee - slim torso
      const cropGeo = new THREE.CylinderGeometry(0.125, 0.108, 0.25, 8);
      const crop = new THREE.Mesh(cropGeo, mat);
      crop.position.set(0, 0.65, 0);

      // Exposed midriff
      const midriffGeo = new THREE.CylinderGeometry(0.102, 0.122, 0.14, 8);
      const midriff = new THREE.Mesh(midriffGeo, this.skinMat);
      midriff.position.set(0, 0.465, 0);

      g.add(crop, midriff);
    } else if (type === "corset_cami") {
      // Fairycore lace corseted camisole - slender waist
      const corsetGeo = new THREE.CylinderGeometry(0.125, 0.108, 0.34, 8);
      const corset = new THREE.Mesh(corsetGeo, mat);
      corset.position.set(0, 0.59, 0);

      // Ribbons / boning lines
      const laceMat = new THREE.MeshBasicMaterial({ color: accentColor });
      for (let i = -2; i <= 2; i++) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.30, 0.008), laceMat);
        line.position.set(i * 0.032, 0.59, 0.128);
        g.add(line);
      }
      g.add(corset);
    } else if (type === "track_jacket") {
      // Sporty Y2K zip windbreaker - slim silhouette
      const jacketGeo = new THREE.CylinderGeometry(0.145, 0.155, 0.42, 8);
      const jacket = new THREE.Mesh(jacketGeo, mat);
      jacket.position.set(0, 0.56, 0);

      // Zipper line
      const zip = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, 0.42, 0.016),
        this.jewelryMat
      );
      zip.position.set(0, 0.56, 0.158);

      // Contrast racing stripes on chest
      const stripeMat = new THREE.MeshBasicMaterial({ color: accentColor });
      const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.016, 0.008), stripeMat);
      stripeL.position.set(-0.07, 0.62, 0.155);
      const stripeR = stripeL.clone();
      stripeR.position.x = 0.07;

      g.add(jacket, zip, stripeL, stripeR);
    } else {
      // fishnet_knit - slender drape
      const knitMat = new THREE.MeshStandardMaterial({
        color: mainColor,
        roughness: 0.9,
        wireframe: true,
      });
      const knitGeo = new THREE.CylinderGeometry(0.145, 0.16, 0.44, 8);
      const knit = new THREE.Mesh(knitGeo, knitMat);
      knit.position.set(0, 0.54, 0);

      // Inner cami under fishnet
      const inner = new THREE.Mesh(
        new THREE.CylinderGeometry(0.125, 0.11, 0.34, 8),
        new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, flatShading: true })
      );
      inner.position.set(0, 0.58, 0);

      g.add(inner, knit);
    }

    return g;
  }

  // ---------------- Arms ----------------
  _buildArms(topType, topColor, accentColor, skinColor) {
    const g = new THREE.Group();

    if (topType === "asym_bell_sleeve") {
      // Asymmetrical sleeve outfit (Picture Match) - Narrow anime shoulder & slender bare arm:
      const topTex = this._createFloralTopTexture(
        topColor.getHexString(),
        accentColor.getHexString()
      );
      const sleeveMat = new THREE.MeshStandardMaterial({
        color: topColor,
        map: topTex,
        roughness: 0.8,
        flatShading: true,
        wireframe: this.wireframeMode,
      });

      // 1. Right Arm (Bare skin, slender cylinder & dainty anime hand)
      const rArmGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.33, 6);
      rArmGeo.translate(0, -0.165, 0);
      const rightArm = new THREE.Mesh(rArmGeo, this.skinMat);
      rightArm.position.set(0.155, 0.72, 0);
      rightArm.rotation.z = -0.09;
      rightArm.rotation.x = -0.04;

      const rForeGeo = new THREE.CylinderGeometry(0.022, 0.018, 0.30, 6);
      rForeGeo.translate(0, -0.15, 0);
      const rightFore = new THREE.Mesh(rForeGeo, this.skinMat);
      rightFore.position.set(0, -0.33, 0);
      rightFore.rotation.z = 0.06;
      rightArm.add(rightFore);

      const rHandGeo = new THREE.BoxGeometry(0.032, 0.060, 0.020);
      rHandGeo.translate(0, -0.030, 0);
      const rightHand = new THREE.Mesh(rHandGeo, this.skinMat);
      rightHand.position.set(0, -0.30, 0);
      rightFore.add(rightHand);

      // 2. Left Arm (Dramatic flared bell sleeve from narrow shoulder)
      const leftArm = new THREE.Group();
      leftArm.position.set(-0.155, 0.72, 0);
      leftArm.rotation.z = 0.09;
      leftArm.rotation.x = -0.04;

      // Off-shoulder ruffled cuff around shoulder
      const cuffGeo = new THREE.TorusGeometry(0.042, 0.010, 6, 10);
      cuffGeo.rotateX(Math.PI / 2);
      const cuffMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.7, flatShading: true });
      const cuff = new THREE.Mesh(cuffGeo, cuffMat);
      cuff.position.set(0, -0.02, 0);
      leftArm.add(cuff);

      // Upper arm under sleeve
      const lArmGeo = new THREE.CylinderGeometry(0.030, 0.038, 0.32, 6);
      lArmGeo.translate(0, -0.16, 0);
      const leftArmMesh = new THREE.Mesh(lArmGeo, sleeveMat);
      leftArm.add(leftArmMesh);

      // Dramatic flared bell sleeve drape
      const bellGeo = new THREE.CylinderGeometry(0.038, 0.115, 0.44, 8, 1, false);
      bellGeo.translate(0, -0.22, 0);
      const bellMesh = new THREE.Mesh(bellGeo, sleeveMat);
      bellMesh.position.set(0, -0.22, 0);
      bellMesh.rotation.z = -0.05;
      leftArm.add(bellMesh);

      // Ruffled scalloped trim at bottom of bell sleeve
      const bellRuffleGeo = new THREE.TorusGeometry(0.115, 0.012, 6, 12);
      bellRuffleGeo.rotateX(Math.PI / 2);
      const bellRuffle = new THREE.Mesh(bellRuffleGeo, cuffMat);
      bellRuffle.position.set(0, -0.44, 0);
      bellMesh.add(bellRuffle);

      // Left hand peeking out of bell sleeve
      const lHandGeo = new THREE.BoxGeometry(0.032, 0.060, 0.020);
      lHandGeo.translate(0, -0.030, 0);
      const leftHand = new THREE.Mesh(lHandGeo, this.skinMat);
      leftHand.position.set(0, -0.44, 0);
      leftArm.add(leftHand);

      g.add(leftArm, rightArm);
      return g;
    }

    const isLongSleeve = topType === "track_jacket" || topType === "fishnet_knit";
    const armMat = isLongSleeve
      ? new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.8, flatShading: true, wireframe: this.wireframeMode })
      : this.skinMat;

    // Slender arms from narrow shoulders
    const armGeo = new THREE.CylinderGeometry(0.026, 0.022, 0.33, 6);
    armGeo.translate(0, -0.165, 0);

    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.155, 0.72, 0);
    leftArm.rotation.z = 0.09;
    leftArm.rotation.x = -0.04;

    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.155, 0.72, 0);
    rightArm.rotation.z = -0.09;
    rightArm.rotation.x = -0.04;

    // Forearms with optional Y2K arm warmers
    const foreMat = (topType === "layered_baby_tee" || topType === "oversized_tee")
      ? new THREE.MeshStandardMaterial({
          map: this._createStripedTexture(topColor.getHexString(), accentColor.getHexString(), 6),
          roughness: 0.8,
          wireframe: this.wireframeMode,
        })
      : armMat;

    const foreGeo = new THREE.CylinderGeometry(0.022, 0.018, 0.30, 6);
    foreGeo.translate(0, -0.15, 0);

    const leftFore = new THREE.Mesh(foreGeo, foreMat);
    leftFore.position.set(0, -0.33, 0);
    leftFore.rotation.z = -0.06;
    leftArm.add(leftFore);

    const rightFore = new THREE.Mesh(foreGeo, foreMat);
    rightFore.position.set(0, -0.33, 0);
    rightFore.rotation.z = 0.06;
    rightArm.add(rightFore);

    // Dainty hands
    const handGeo = new THREE.BoxGeometry(0.032, 0.060, 0.020);
    handGeo.translate(0, -0.030, 0);
    const leftHand = new THREE.Mesh(handGeo, this.skinMat);
    leftHand.position.set(0, -0.30, 0);
    leftFore.add(leftHand);

    const rightHand = new THREE.Mesh(handGeo, this.skinMat);
    rightHand.position.set(0, -0.30, 0);
    rightFore.add(rightHand);

    g.add(leftArm, rightArm);
    return g;
  }

  // ---------------- Clothing Bottoms ----------------
  _buildBottom(type, color, accentColor) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      roughness: 0.8,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    if (type === "baggy_skater_pants") {
      // Slender low-rise skater pants with graceful baggy drape (Picture Match)
      const pantsMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.85,
        flatShading: true,
        wireframe: this.wireframeMode,
      });

      // Elongated slender legs with tapered loose drape (not thick rectangular cylinders)
      const legGeo = new THREE.CylinderGeometry(0.074, 0.096, 0.58, 8);
      legGeo.translate(0, -0.29, 0);

      const leftLeg = new THREE.Mesh(legGeo, pantsMat);
      leftLeg.position.set(-0.065, 0.41, 0);

      const rightLeg = new THREE.Mesh(legGeo, pantsMat);
      rightLeg.position.set(0.065, 0.41, 0);

      // Low waistband sitting below navel
      const waistGeo = new THREE.TorusGeometry(0.128, 0.012, 6, 12);
      waistGeo.rotateX(Math.PI / 2);
      const waist = new THREE.Mesh(waistGeo, pantsMat);
      waist.position.set(0, 0.41, 0);

      // Silver metal button / rivet on fly
      const rivet = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.008), this.jewelryMat);
      rivet.position.set(0, 0.41, 0.132);

      // Wrinkles and baggy folds pooled loosely around lower ankles
      const foldGeo = new THREE.TorusGeometry(0.098, 0.016, 6, 10);
      foldGeo.rotateX(Math.PI / 2);
      const foldL = new THREE.Mesh(foldGeo, pantsMat);
      foldL.position.set(0, -0.52, 0);
      leftLeg.add(foldL);

      const foldR = foldL.clone();
      rightLeg.add(foldR);

      g.add(leftLeg, rightLeg, waist, rivet);
    } else if (type === "pleated_skirt") {
      // Low-poly pleated anime skirt - slender waist
      const skirtGeo = new THREE.CylinderGeometry(0.13, 0.25, 0.24, 14, 1, true);
      const skirt = new THREE.Mesh(skirtGeo, mat);
      skirt.position.set(0, 0.32, 0);
      skirt.castShadow = true;
      skirt.receiveShadow = true;

      // Belt with buckle
      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.132, 0.012, 6, 14),
        this.jewelryMat
      );
      belt.rotation.x = Math.PI / 2;
      belt.position.set(0, 0.43, 0);

      g.add(skirt, belt);
    } else if (type === "cargo_pants") {
      // Slender Y2K parachute cargo pants
      const pantsMat = new THREE.MeshStandardMaterial({
        color: color,
        roughness: 0.85,
        flatShading: true,
        wireframe: this.wireframeMode,
      });

      const legGeo = new THREE.CylinderGeometry(0.068, 0.082, 0.58, 8);
      legGeo.translate(0, -0.29, 0);

      const leftLeg = new THREE.Mesh(legGeo, pantsMat);
      leftLeg.position.set(-0.065, 0.42, 0);

      const rightLeg = new THREE.Mesh(legGeo, pantsMat);
      rightLeg.position.set(0.065, 0.42, 0);

      // Flap cargo pockets on outer thighs
      const pocketGeo = new THREE.BoxGeometry(0.025, 0.10, 0.06);
      const leftPocket = new THREE.Mesh(pocketGeo, pantsMat);
      leftPocket.position.set(-0.075, -0.16, 0);
      leftLeg.add(leftPocket);

      const rightPocket = new THREE.Mesh(pocketGeo, pantsMat);
      rightPocket.position.set(0.075, -0.16, 0);
      rightLeg.add(rightPocket);

      g.add(leftLeg, rightLeg);
    } else if (type === "tulle_skirt") {
      // Fairycore tiered handkerchief-hem skirt - slender silhouette
      const fairyMat = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: 0.85,
        roughness: 0.6,
        flatShading: true,
        side: THREE.DoubleSide,
        wireframe: this.wireframeMode,
      });

      const tier1 = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 10, 1, true), fairyMat);
      tier1.rotation.x = Math.PI;
      tier1.position.set(0, 0.29, 0);

      const tier2 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.34, 12, 1, true), fairyMat);
      tier2.rotation.x = Math.PI;
      tier2.position.set(0, 0.25, 0);

      g.add(tier1, tier2);
    } else {
      // denim_shorts - slender fit
      const shortsGeo = new THREE.CylinderGeometry(0.13, 0.145, 0.15, 8);
      const shorts = new THREE.Mesh(shortsGeo, mat);
      shorts.position.set(0, 0.38, 0);
      g.add(shorts);
    }

    return g;
  }

  // ---------------- Chain Belt Accessory ----------------
  _addChainBelt(parent) {
    const chainMat = this.jewelryMat;
    const curve = new THREE.EllipseCurve(0, 0, 0.15, 0.15, -Math.PI / 4, Math.PI / 4, false, 0);
    const pts = curve.getPoints(12);
    const chainGeo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, -0.04 + Math.sin(p.x * 8) * 0.015, p.y)));
    chainGeo.rotateX(Math.PI / 2);

    const chain = new THREE.Line(chainGeo, new THREE.LineBasicMaterial({ color: 0xd0d0d0 }));
    chain.position.set(0, 0.41, 0.06);

    // Star charm dangling from hip
    const starGeo = new THREE.OctahedronGeometry(0.02, 0);
    const charm = new THREE.Mesh(starGeo, chainMat);
    charm.position.set(0.12, 0.35, 0.08);

    parent.add(chain, charm);
  }

  // ---------------- Legs & Shoes ----------------
  _buildLegsAndShoes(type, shoesColor, accentColor, skinColor) {
    const g = new THREE.Group();

    // Upper/Lower Legs (Skin or Stockings) - Long, slender anime legs
    const isPants = this.config.bottom === "cargo_pants" || this.config.bottom === "baggy_skater_pants";
    if (!isPants) {
      const legGeo = new THREE.CylinderGeometry(0.042, 0.032, 0.56, 6);
      legGeo.translate(0, -0.28, 0);

      const leftLeg = new THREE.Mesh(legGeo, this.skinMat);
      leftLeg.position.set(-0.065, 0.42, 0);

      const rightLeg = new THREE.Mesh(legGeo, this.skinMat);
      rightLeg.position.set(0.065, 0.42, 0);

      g.add(leftLeg, rightLeg);
    }

    // Shoes
    const shoeMat = new THREE.MeshStandardMaterial({
      color: shoesColor,
      roughness: 0.5,
      metalness: 0.1,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    const buildSingleShoe = (x) => {
      const s = new THREE.Group();
      s.position.set(x, 0.06, 0.02);

      if (type === "platform_boots") {
        // Goth platform boots - slender ankle shaft & proportionate sole
        const bootLeg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.048, 0.042, 0.28, 6),
          shoeMat
        );
        bootLeg.position.set(0, 0.12, 0);

        // Blocky sole
        const soleGeo = new THREE.BoxGeometry(0.075, 0.065, 0.17);
        const sole = new THREE.Mesh(soleGeo, new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.9 }));
        sole.position.set(0, -0.02, 0.02);

        // Silver buckles
        const buckleGeo = new THREE.BoxGeometry(0.065, 0.012, 0.012);
        const b1 = new THREE.Mesh(buckleGeo, this.jewelryMat);
        b1.position.set(0, 0.14, 0.065);
        const b2 = b1.clone();
        b2.position.y = 0.07;

        s.add(bootLeg, sole, b1, b2);
      } else if (type === "cyber_sneakers") {
        // Retro low-top cyber kicks
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.065, 0.16), shoeMat);
        foot.position.set(0, 0.02, 0.02);

        // Glowing neon sole
        const soleMat = new THREE.MeshBasicMaterial({ color: accentColor });
        const sole = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.025, 0.18), soleMat);
        sole.position.set(0, -0.03, 0.02);

        s.add(foot, sole);
      } else if (type === "leg_warmers") {
        // Slouchy ribbed leg warmers
        const warmerMat = new THREE.MeshStandardMaterial({
          color: accentColor,
          roughness: 0.9,
          flatShading: true,
          wireframe: this.wireframeMode,
        });
        const warmerGeo = new THREE.CylinderGeometry(0.055, 0.072, 0.26, 8);
        const warmer = new THREE.Mesh(warmerGeo, warmerMat);
        warmer.position.set(0, 0.12, 0);

        // Mary Jane shoe base
        const shoe = new THREE.Mesh(
          new THREE.BoxGeometry(0.072, 0.05, 0.15),
          shoeMat
        );
        shoe.position.set(0, 0.01, 0.02);

        s.add(warmer, shoe);
      } else {
        // ballet_flats with ribbon laces
        const flat = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.035, 0.15), shoeMat);
        flat.position.set(0, 0, 0.02);

        // Criss-cross ribbons
        const ribbonMat = new THREE.MeshBasicMaterial({ color: shoesColor });
        for (let r = 0; r < 4; r++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.006, 4, 8), ribbonMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(0, 0.05 + r * 0.05, 0);
          s.add(ring);
        }
        s.add(flat);
      }

      return s;
    };

    g.add(buildSingleShoe(-0.065));
    g.add(buildSingleShoe(0.065));
    return g;
  }

  // ---------------- Fairy Wings ----------------
  _buildWings(style, colorHex = "#00ffee") {
    const g = new THREE.Group();
    const wingColor = new THREE.Color(colorHex);

    const wingMat = new THREE.MeshStandardMaterial({
      color: wingColor,
      transparent: true,
      opacity: 0.65,
      roughness: 0.2,
      metalness: 0.3,
      side: THREE.DoubleSide,
      flatShading: true,
      wireframe: this.wireframeMode,
    });

    const buildWingPair = (scale = 1.0) => {
      const pair = new THREE.Group();

      const wingShape = new THREE.Shape();
      if (style === "bat_fairy") {
        // Angular gothic fairy bat wing
        wingShape.moveTo(0, 0);
        wingShape.lineTo(-0.25, 0.45);
        wingShape.lineTo(-0.15, 0.28);
        wingShape.lineTo(-0.38, 0.25);
        wingShape.lineTo(-0.22, 0.1);
        wingShape.lineTo(-0.35, -0.1);
        wingShape.lineTo(0, -0.05);
      } else {
        // Delicate gossamer butterfly / dragonfly wings
        wingShape.moveTo(0, 0);
        wingShape.quadraticCurveTo(-0.15, 0.35, -0.42, 0.48);
        wingShape.quadraticCurveTo(-0.48, 0.25, -0.32, 0.1);
        wingShape.quadraticCurveTo(-0.42, -0.15, -0.22, -0.32);
        wingShape.quadraticCurveTo(-0.08, -0.18, 0, 0);
      }
      wingShape.closePath();

      const wingGeo = new THREE.ShapeGeometry(wingShape);

      const leftWing = new THREE.Mesh(wingGeo, wingMat);
      leftWing.rotation.y = 0.2;

      const rightWing = leftWing.clone();
      rightWing.scale.set(-1, 1, 1);
      rightWing.rotation.y = -0.2;

      pair.add(leftWing, rightWing);
      pair.scale.set(scale, scale, scale);
      return pair;
    };

    const mainWings = buildWingPair(1.2);
    const lowerWings = buildWingPair(0.75);
    lowerWings.position.set(0, -0.12, -0.02);

    g.add(mainWings, lowerWings);
    g.userData = { mainWings, lowerWings };
    return g;
  }

  // ---------------- PS1 Vertex Wobble & Animation Loop ----------------
  _animate() {
    if (!this.animating) return;
    requestAnimationFrame(this._animate);

    const delta = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    this.controls.update();

    // Gentle idle breathing
    if (this.character && this.headGroup && this.bodyGroup) {
      this.bodyGroup.position.y = Math.sin(time * 2.5) * 0.008;
      this.headGroup.rotation.y = Math.sin(time * 1.2) * 0.04;
      this.headGroup.position.y = 0.92 + Math.sin(time * 2.5) * 0.006;
    }

    // Fairy wings fluttering
    if (this.wingsGroup && this.wingsGroup.userData.mainWings) {
      const flutter = Math.sin(time * 7) * 0.22;
      this.wingsGroup.userData.mainWings.children[0].rotation.y = 0.2 + flutter;
      this.wingsGroup.userData.mainWings.children[1].rotation.y = -0.2 - flutter;
      if (this.wingsGroup.userData.lowerWings) {
        this.wingsGroup.userData.lowerWings.children[0].rotation.y = 0.25 + flutter * 0.8;
        this.wingsGroup.userData.lowerWings.children[1].rotation.y = -0.25 - flutter * 0.8;
      }
    }

    // Float particles
    for (const p of this.particles) {
      p.position.y += p.userData.speedY * delta;
      p.rotation.x += p.userData.rotSpeed * delta;
      p.rotation.y += p.userData.rotSpeed * delta;
      if (p.position.y > 2.8) {
        p.position.y = 0.05;
        p.position.x = (Math.random() - 0.5) * 4;
        p.position.z = (Math.random() - 0.5) * 4;
      }
    }

    // PS1 Vertex Wobble Simulation
    if (this.wobbleEnabled && this.character) {
      // Periodic subtle integer grid snap jitter (classic PS1 wobble)
      const wobbleFreq = 18;
      const wobbleStep = 1 / 180;
      const tSnap = Math.floor(time * wobbleFreq);
      const wobbleX = (Math.sin(tSnap * 12.9898) % 1) * wobbleStep;
      const wobbleY = (Math.cos(tSnap * 78.233) % 1) * wobbleStep;
      this.character.position.x = wobbleX;
      this.character.position.z = wobbleY;
    } else if (this.character) {
      this.character.position.x = 0;
      this.character.position.z = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }

  toggleWobble(enabled) {
    this.wobbleEnabled = enabled;
  }

  toggleWireframe(enabled) {
    this.wireframeMode = enabled;
    this.scene.traverse((obj) => {
      if (obj.isMesh && obj.material && obj !== this.grid) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => (m.wireframe = enabled));
        } else {
          obj.material.wireframe = enabled;
        }
      }
    });
  }

  // ---------------- Export Features ----------------
  async exportGLBData() {
    try {
      const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
      const exporter = new GLTFExporter();
      return new Promise((resolve) => {
        exporter.parse(
          this.character,
          (gltf) => {
            const bytes = new Uint8Array(gltf);
            let binary = "";
            const len = bytes.byteLength;
            const chunkSize = 8192;
            for (let i = 0; i < len; i += chunkSize) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
            }
            const b64 = btoa(binary);
            resolve({ ok: true, glbBase64: b64, rawBuffer: gltf });
          },
          (error) => {
            console.error("GLTF export error:", error);
            resolve({ ok: false, error: String(error) });
          },
          { binary: true }
        );
      });
    } catch (err) {
      console.error("GLTFExporter import failed:", err);
      return { ok: false, error: String(err) };
    }
  }

  async exportGLB(callback) {
    const res = await this.exportGLBData();
    if (res.ok) {
      const blob = new Blob([res.rawBuffer], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ps1_anime_${this.config.id || "avatar"}.glb`;
      a.click();
      URL.revokeObjectURL(url);
      if (callback) callback({ ok: true });
    } else {
      if (callback) callback(res);
    }
  }

  captureSnapshot(width = 512, height = 512) {
    const prevW = this.canvas.width;
    const prevH = this.canvas.height;

    // Render snapshot
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);

    const dataUrl = this.canvas.toDataURL("image/png");

    // Restore viewport size
    this.resize();
    return dataUrl;
  }

  dispose() {
    this.animating = false;
    window.removeEventListener("resize", this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
