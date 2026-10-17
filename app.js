import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const els = {
  apiStatusText: $('apiStatusText'), dropZone: $('dropZone'), fileInput: $('fileInput'), uploadPrompt: $('uploadPrompt'),
  uploadPreview: $('uploadPreview'), sourceImagesPreview: $('sourceImagesPreview'), removeImage: $('removeImage'), generateButton: $('generateButton'),
  generateButtonText: $('generateButtonText'), buttonCaption: $('buttonCaption'), qualityOptions: [...document.querySelectorAll('.quality-option')],
  materialPrompt: $('materialPrompt'), promptCount: $('promptCount'), textureToggle: $('textureToggle'), pbrToggle: $('pbrToggle'),
  viewportTitle: $('viewportTitle'), viewportMode: $('viewportMode'), viewportPip: $('viewportPip'), emptyState: $('emptyState'),
  scanOverlay: $('scanOverlay'), scanStatusText: $('scanStatusText'), scanProgress: $('scanProgress'), meshReadout: $('meshReadout'),
  footerStatus: $('footerStatus'), resetView: $('resetView'), rotateToggle: $('rotateToggle'), exportButton: $('exportButton'),
  exportTitle: $('exportTitle'), exportDescription: $('exportDescription'), toast: $('toast'), helpButton: $('helpButton'),
  helpModal: $('helpModal'), closeHelp: $('closeHelp'), modalApiStatus: $('modalApiStatus')
};
const generateArea = $('generateArea');
if (generateArea) generateArea.append(els.generateButton, els.buttonCaption);

let selectedFiles = [];
let sourceDataUrls = [];
let selectedQuality = 'medium';
let activeTaskId = null;
let generatedModelUrl = null;
let generatedModelName = 'formforge-model.glb';
let pollTimer = null;
let toastTimer = null;
let isGenerating = false;
let loadedModel = null;
let currentProgress = 0;
let autoRotate = true;
let placeholderGroup = null;
let meshStats = { triangles: 0, meshes: 0 };

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0e1111');
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
camera.position.set(4.2, 2.7, 5.7);
const renderer = new THREE.WebGLRenderer({ canvas: $('modelCanvas'), antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 1.8;
controls.maxDistance = 14;
controls.target.set(0, 0.35, 0);
scene.add(new THREE.HemisphereLight(0xc9e6d8, 0x18201c, 2.0));
const keyLight = new THREE.DirectionalLight(0xfff5dd, 3.1); keyLight.position.set(4, 6, 5); keyLight.castShadow = true; scene.add(keyLight);
const rimLight = new THREE.PointLight(0x9bdafa, 45, 18); rimLight.position.set(-4, 2.5, -4); scene.add(rimLight);
const limeLight = new THREE.PointLight(0xd4fb65, 22, 13); limeLight.position.set(2, -1, 3); scene.add(limeLight);
const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 96), new THREE.MeshStandardMaterial({ color: '#171d1a', roughness: 0.84, metalness: 0.12 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -1.25; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(12, 40, '#344039', '#252d2a'); grid.position.y = -1.24; grid.material.transparent = true; grid.material.opacity = 0.27; scene.add(grid);

function buildPlaceholder() {
  placeholderGroup = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1.15, 4);
  const pos = geo.attributes.position;
  const colors = [];
  const cA = new THREE.Color('#26382e');
  const cB = new THREE.Color('#b6dc89');
  for (let i = 0; i < pos.count; i++) {
    const n = (Math.sin(pos.getX(i) * 4.8 + pos.getY(i) * 5.1) + 1) / 2;
    const col = cA.clone().lerp(cB, n * 0.48);
    colors.push(col.r, col.g, col.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const core = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.24, emissive: '#243323', emissiveIntensity: 0.18, flatShading: false }));
  core.castShadow = true; placeholderGroup.add(core);
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(1.19, 2), new THREE.MeshBasicMaterial({ color: '#b7ef7b', wireframe: true, transparent: true, opacity: 0.22 }));
  placeholderGroup.add(wire);
  const orbitMaterial = new THREE.MeshBasicMaterial({ color: '#88b9a0', transparent: true, opacity: 0.5 });
  const orbit1 = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.006, 6, 180), orbitMaterial); orbit1.rotation.set(0.7, 0.15, 0.3); placeholderGroup.add(orbit1);
  const orbit2 = new THREE.Mesh(new THREE.TorusGeometry(1.63, 0.004, 6, 180), new THREE.MeshBasicMaterial({ color: '#d4fb65', transparent: true, opacity: 0.35 })); orbit2.rotation.set(1.2, 0.9, 0); placeholderGroup.add(orbit2);
  placeholderGroup.position.y = 0.2;
  scene.add(placeholderGroup);
}
buildPlaceholder();

function resizeRenderer() {
  const wrap = $('canvasWrap');
  const width = Math.max(1, wrap.clientWidth);
  const height = Math.max(1, wrap.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
if (window.ResizeObserver) new ResizeObserver(resizeRenderer).observe($('canvasWrap'));
resizeRenderer();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  if (autoRotate && loadedModel) loadedModel.rotation.y += dt * 0.28;
  if (placeholderGroup && !loadedModel && !isGenerating) {
    placeholderGroup.rotation.y += dt * 0.12;
    placeholderGroup.rotation.x = Math.sin(clock.elapsedTime * 0.22) * 0.07;
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 4200);
}

// FormForge uses a local Apple-Silicon engine. No cloud API key or shared quota.
const isLocalFormForge = ['localhost', '127.0.0.1'].includes(window.location.hostname);
window.formforgeConfigured = false;
els.apiStatusText.textContent = isLocalFormForge ? 'CHECKING LOCAL ENGINE' : 'LOCAL ENGINE REQUIRED';
els.buttonCaption.textContent = 'ADD AN IMAGE TO BEGIN';
fetch('/api/health').then((r) => { if (!r.ok) throw new Error('offline'); return r.json(); }).then((data) => {
  window.formforgeConfigured = Boolean(data.ready);
  els.apiStatusText.textContent = data.ready ? 'LOCAL ENGINE READY' : 'ENGINE STARTING';
  if (els.modalApiStatus) els.modalApiStatus.textContent = data.ready ? 'Local engine is running on this Mac.' : 'Engine is running; model weights load when you generate.';
}).catch(() => {
  els.apiStatusText.textContent = 'OPEN LOCAL APP';
  if (els.modalApiStatus) els.modalApiStatus.textContent = 'Open http://127.0.0.1:8765 and start the local engine first.';
});

function humanSize(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function setImages(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  if (files.length > 4) { showToast('Choose up to 4 images of the same object.', true); return; }
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  for (const file of files) {
    if (!allowed.includes(file.type)) { showToast('Choose JPG, PNG or WebP images.', true); return; }
    if (file.size > 20 * 1024 * 1024) { showToast('Each image must be 20 MB or smaller.', true); return; }
  }
  Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read an image.'));
    reader.onload = () => resolve({ file, dataUrl: reader.result }); reader.readAsDataURL(file);
  }))).then((items) => {
    selectedFiles = items.map(x => x.file); sourceDataUrls = items.map(x => x.dataUrl);
    els.sourceImagesPreview.replaceChildren();
    items.forEach(({file,dataUrl}) => { const img=document.createElement('img'); img.src=dataUrl; img.alt=file.name; img.title=file.name; els.sourceImagesPreview.appendChild(img); });
    els.uploadPrompt.classList.add('hidden'); els.uploadPreview.classList.remove('hidden');
    const local=['localhost','127.0.0.1'].includes(window.location.hostname);
    els.generateButton.disabled=!local; els.buttonCaption.textContent=local?'READY TO GENERATE':'OPEN THE LOCAL APP TO GENERATE';
    els.exportTitle.textContent='Source images loaded';
    els.exportDescription.textContent=`${items.length} image${items.length===1?'':'s'} · ${humanSize(items.reduce((sum,x)=>sum+x.file.size,0))}. Generate to create your 3D mesh.`;
    setViewportState('IMAGE LOADED','SOURCE READY'); showToast(`${items.length} reference image${items.length===1?'':'s'} loaded`);
  }).catch(err=>showToast(err.message,true));
}
els.dropZone.addEventListener('click',(event)=>{if(event.target===els.fileInput||event.target.closest('#removeImage'))return;els.fileInput.click();});
els.dropZone.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();els.fileInput.click();}});
els.fileInput.addEventListener('change',()=>{setImages(els.fileInput.files);els.fileInput.value='';});
for(const type of ['dragenter','dragover'])els.dropZone.addEventListener(type,event=>{event.preventDefault();els.dropZone.classList.add('dragover');});
for(const type of ['dragleave','drop'])els.dropZone.addEventListener(type,event=>{event.preventDefault();els.dropZone.classList.remove('dragover');});
els.dropZone.addEventListener('drop',event=>setImages(event.dataTransfer?.files));
els.removeImage.addEventListener('click', (event) => {
  event.stopPropagation();
  selectedFiles = []; sourceDataUrls = []; activeTaskId = null; generatedModelUrl = null; isGenerating = false;
  els.sourceImagesPreview.replaceChildren(); els.uploadPreview.classList.add('hidden'); els.uploadPrompt.classList.remove('hidden');
  els.generateButton.disabled = true; els.exportButton.disabled = true;
  els.exportTitle.textContent = 'Your model will appear here'; els.exportDescription.textContent = 'Generate to unlock your GLB export.';
  els.buttonCaption.textContent = 'ADD AN IMAGE TO BEGIN'; setViewportState('STANDBY', 'NO MESH LOADED');
  if (pollTimer) clearTimeout(pollTimer);
  clearLoadedModel(); showToast('Source image removed.');
});

els.qualityOptions.forEach((button) => button.addEventListener('click', () => {
  selectedQuality = button.dataset.quality;
  els.qualityOptions.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
}));
function updateMaterialToggleState() {
  const label = document.querySelector('.setting-block .on-label');
  const textureOn = els.textureToggle.checked;
  const pbrOn = textureOn && els.pbrToggle.checked;
  els.pbrToggle.disabled = !textureOn;
  els.pbrToggle.closest('.toggle-row').style.opacity = textureOn ? '1' : '.45';
  label.textContent = textureOn && pbrOn ? 'ON' : textureOn || pbrOn ? 'PARTIAL' : 'OFF';
}
els.textureToggle.addEventListener('change', updateMaterialToggleState);
els.pbrToggle.addEventListener('change', updateMaterialToggleState);
updateMaterialToggleState();
els.materialPrompt.addEventListener('input', () => { els.promptCount.textContent = `${els.materialPrompt.value.length} / 800`; });

function setViewportState(chip, readout) {
  els.viewportMode.textContent = chip;
  els.meshReadout.textContent = readout;
  els.viewportMode.classList.toggle('is-ready', chip === 'MODEL READY');
  els.viewportPip.style.background = chip === 'GENERATING' ? '#9ad9f7' : chip === 'MODEL READY' ? 'var(--acid)' : '#6d7770';
  els.footerStatus.classList.toggle('ready', chip === 'MODEL READY');
  const footerText = els.footerStatus.querySelector('span:last-child');
  footerText.textContent = chip === 'GENERATING' ? 'GENERATING MESH' : chip === 'MODEL READY' ? 'MODEL READY TO EXPORT' : chip === 'FAILED' ? 'GENERATION FAILED' : chip === 'IMAGE LOADED' ? 'SOURCE IMAGE LOADED' : 'WAITING FOR INPUT';
}
function clearLoadedModel() {
  if (loadedModel) { scene.remove(loadedModel); disposeObject(loadedModel); loadedModel = null; }
  if (placeholderGroup) placeholderGroup.visible = true;
  meshStats = { triangles: 0, meshes: 0 };
  camera.position.set(4.2, 2.7, 5.7); controls.target.set(0, 0.35, 0); controls.update();
}
function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) for (const material of (Array.isArray(obj.material) ? obj.material : [obj.material])) {
      for (const value of Object.values(material)) if (value?.isTexture) value.dispose();
      material.dispose();
    }
  });
}
function fmtCount(n) { return n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n); }
function loadModel(modelUrl) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(modelUrl, (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.scale.multiplyScalar(2.55 / maxDim);
      const centeredBox = new THREE.Box3().setFromObject(model);
      model.position.y -= centeredBox.min.y + 0.8;
      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true; obj.receiveShadow = true;
          meshStats.meshes++;
          if (obj.geometry?.index) meshStats.triangles += obj.geometry.index.count / 3;
          else if (obj.geometry?.attributes?.position) meshStats.triangles += obj.geometry.attributes.position.count / 3;
        }
      });
      resolve(model);
    }, undefined, reject);
  });
}

function modelUrlOrAbsolute(url) { return new URL(url, window.location.href).href; }

async function generateModel() {
  if (!selectedFiles.length || isGenerating) return;
  isGenerating = true;
  currentProgress = 4;
  const taskId = `job-${Date.now()}`;
  activeTaskId = taskId;
  generatedModelUrl = null;
  els.generateButton.disabled = true;
  els.generateButtonText.textContent = 'GENERATING YOUR MODEL…';
  els.buttonCaption.textContent = 'GENERATING LOCALLY ON YOUR MAC';
  els.emptyState.classList.add('hidden');
  els.scanOverlay.classList.remove('hidden');
  els.exportButton.disabled = true;
  els.exportTitle.textContent = 'Creating your 3D model…';
  els.exportDescription.textContent = 'This usually takes a little while. Keep this page open.';
  setViewportState('GENERATING', 'BUILDING YOUR MODEL');
  els.scanStatusText.textContent = 'PREPARING YOUR IMAGE';
  els.scanProgress.textContent = '4%';

  const advanceProgress = () => {
    if (!isGenerating || taskId !== activeTaskId) return;
    currentProgress = Math.min(92, currentProgress + 6);
    els.scanProgress.textContent = `${Math.round(currentProgress)}%`;
    els.scanStatusText.textContent = currentProgress < 28 ? 'PREPARING YOUR IMAGE'
      : currentProgress < 58 ? 'BUILDING 3D GEOMETRY'
      : currentProgress < 84 ? 'ADDING SURFACE DETAIL'
      : 'PACKAGING GLB FILE';
    pollTimer = setTimeout(advanceProgress, 4500);
  };
  pollTimer = setTimeout(advanceProgress, 1800);

  try {
    els.scanStatusText.textContent = 'RUNNING ON YOUR MAC';
    const form = new FormData();
    selectedFiles.forEach(file => form.append('images', file, file.name));
    form.append('quality', selectedQuality);
    form.append('texture', String(els.textureToggle.checked));
    form.append('pbr', String(els.pbrToggle.checked));
    form.append('material_prompt', els.materialPrompt.value.trim());
    const response = await fetch('/api/generate', { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || 'Local generation failed. Check the terminal window for details.');
    if (taskId !== activeTaskId) return;
    if (!payload.modelUrl) throw new Error('The local engine finished without returning a GLB file. Check the terminal output.');
    generatedModelUrl = payload.modelUrl;
    generatedModelName = (selectedFiles[0].name.replace(/\.[^.]+$/, '') || 'formforge-model') + '.glb';
    currentProgress = 100;
    els.scanProgress.textContent = '100%';
    els.scanStatusText.textContent = 'LOADING YOUR MODEL';
    await installGeneratedModel(modelUrlOrAbsolute(payload.modelUrl), taskId);
  } catch (error) {
    if (taskId !== activeTaskId) return;
    const detail = error?.message || 'Local generation failed. Check the terminal window for details.';
    failGeneration(detail);
  }
}
els.generateButton.addEventListener('click', generateModel);

async function installGeneratedModel(modelUrl, taskId) {
  try {
    const model = await loadModel(modelUrl);
    if (taskId !== activeTaskId) { disposeObject(model); return; }
    if (loadedModel) { scene.remove(loadedModel); disposeObject(loadedModel); }
    loadedModel = model;
    if (placeholderGroup) placeholderGroup.visible = false;
    scene.add(loadedModel);
    camera.position.set(3.7, 2.25, 4.5); controls.target.set(0, 0.15, 0); controls.update();
    isGenerating = false;
    if (pollTimer) clearTimeout(pollTimer);
    els.scanOverlay.classList.add('hidden'); els.emptyState.classList.add('hidden');
    els.generateButton.disabled = false; els.generateButtonText.textContent = 'GENERATE ANOTHER MODEL';
    els.buttonCaption.textContent = 'READY FOR ANOTHER IMAGE';
    els.exportButton.disabled = false;
    els.exportTitle.textContent = 'Your 3D model is ready';
    els.exportDescription.textContent = `${fmtCount(Math.round(meshStats.triangles))} triangles · ${meshStats.meshes} mesh parts · GLB download`;
    setViewportState('MODEL READY', `${fmtCount(Math.round(meshStats.triangles))} TRIANGLES`);
    showToast('Done! Your 3D model is ready to download.');
  } catch (error) {
    failGeneration(`The model was generated, but the preview could not load: ${error.message || 'unknown preview error'}. You can still download the GLB.`);
    els.exportButton.disabled = !generatedModelUrl;
  }
}

function failGeneration(message) {
  isGenerating = false;
  if (pollTimer) clearTimeout(pollTimer);
  els.scanOverlay.classList.add('hidden');
  els.emptyState.classList.toggle('hidden', Boolean(loadedModel));
  els.generateButton.disabled = !selectedFiles.length;
  els.generateButtonText.textContent = loadedModel ? 'REGENERATE MODEL' : 'TRY AGAIN';
  els.buttonCaption.textContent = 'PLEASE TRY AGAIN';
  els.exportTitle.textContent = loadedModel ? 'Previous model still available' : 'Generation did not finish';
  els.exportDescription.textContent = message;
  setViewportState('FAILED', 'GENERATION FAILED');
  showToast(message, true);
}

els.exportButton.addEventListener('click', () => {
  if (!generatedModelUrl) return;
  const link=document.createElement('a'); link.href=generatedModelUrl; link.download=generatedModelName||'formforge-model.glb';
  document.body.appendChild(link); link.click(); link.remove(); showToast('Your GLB download has started.');
});
els.resetView.addEventListener('click', () => {
  camera.position.set(4.2, 2.7, 5.7); controls.target.set(0, 0.35, 0); controls.update();
  if (loadedModel) loadedModel.rotation.set(0, 0, 0);
});
els.rotateToggle.addEventListener('click', () => {
  autoRotate = !autoRotate;
  els.rotateToggle.classList.toggle('active', autoRotate);
  els.rotateToggle.querySelector('span').textContent = autoRotate ? 'AUTO ROTATE' : 'ROTATION OFF';
});

function openHelp() { els.helpModal.classList.remove('hidden'); }
function closeHelp() { els.helpModal.classList.add('hidden'); }
els.helpButton.addEventListener('click', openHelp);
els.closeHelp.addEventListener('click', closeHelp);
els.helpModal.addEventListener('click', (event) => { if (event.target === els.helpModal) closeHelp(); });
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeHelp(); });
