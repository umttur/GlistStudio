// 3D models open drawn, not as text: an OBJ with its MTL and texture, a glTF whose buffer's name has
// a space and whose texture is in a subfolder, STL and PLY, each with what it is made of beneath;
// dragging turns it and Reset View brings it back, Wireframe, Grid; a material it names but lacks;
// a broken file; split, closed (its WebGL canvas gone), renamed, deleted, and back after a reload.
// The models are made here; Collada and FBX samples stay out (gs-model.mjs needs Glist's).
import fs from 'node:fs';
import path from 'node:path';
import { e2e, glistApp, repo, writeFiles } from '../common.mjs';

// A unit cube for glTF: 24 vertices (each face its own, for its normal and texture corners).
const gltfCube = () => {
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  const positions = []; const normals = []; const uvs = []; const indices = [];
  faces.forEach(([axis, sign], face) => {
    const [u, v] = [0, 1, 2].filter((each) => each !== axis);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], corner) => {
      const point = [0, 0, 0];
      point[axis] = sign * 0.5; point[u] = a * 0.5 * sign; point[v] = b * 0.5;
      positions.push(...point);
      const normal = [0, 0, 0]; normal[axis] = sign; normals.push(...normal);
      uvs.push([0, 1, 1, 0][corner], [0, 0, 1, 1][corner]);
    });
    indices.push(face * 4, face * 4 + 1, face * 4 + 2, face * 4, face * 4 + 2, face * 4 + 3);
  });
  const buffer = Buffer.concat([new Float32Array(positions), new Float32Array(normals), new Float32Array(uvs), new Uint16Array(indices)].map((array) => Buffer.from(array.buffer)));
  const views = [[0, 288], [288, 288], [576, 192], [768, 72]].map(([byteOffset, byteLength]) => ({ buffer: 0, byteOffset, byteLength }));
  const gltf = {
    asset: { version: '2.0' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    textures: [{ source: 0 }], images: [{ uri: 'textures/logo.png' }],
    buffers: [{ uri: 'cube%20data.bin', byteLength: buffer.length }],
    bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  return { gltf: JSON.stringify(gltf), buffer };
};

await e2e({
  webgl: true,
  setup: (w) => {
    const app = glistApp(w, 'ModelApp');
    const models = `${app}/assets/models`;
    const cube = gltfCube();
    writeFiles(models, {
      'box.obj': ['mtllib box.mtl', 'o Box',
        'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1', 'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
        'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'usemtl skin',
        'f 1/1 4/4 3/3 2/2', 'f 5/1 6/2 7/3 8/4', 'f 1/1 2/2 6/3 5/4', 'f 2/1 3/2 7/3 6/4', 'f 3/1 4/2 8/3 7/4', 'f 4/1 1/2 5/3 8/4', ''].join('\n'),
      'box.mtl': 'newmtl skin\nKd 1 1 1\nmap_Kd logo.png\n',
      'cube/cube.gltf': cube.gltf,
      'cube/cube data.bin': cube.buffer,
      'tetra.stl': ['solid tetra', ...[[[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 0, 0], [0, 0, 1], [1, 0, 0]], [[0, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 0, 1], [0, 1, 0]]]
        .flatMap((triangle) => ['facet normal 0 0 0', 'outer loop', ...triangle.map((point) => `vertex ${point.join(' ')}`), 'endloop', 'endfacet']), 'endsolid tetra', ''].join('\n'),
      'quad.ply': 'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2\n3 0 2 3\n',
      'lost.obj': 'mtllib gone.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nusemtl missing\nf 1 2 3\n',
      'broken.fbx': 'this is not a model at all',
    });
    fs.copyFileSync(path.join(repo, 'assets', 'glistengine.png'), `${models}/logo.png`);
    fs.mkdirSync(`${models}/cube/textures`, { recursive: true });
    fs.copyFileSync(path.join(repo, 'assets', 'glistengine.png'), `${models}/cube/textures/logo.png`);
  },
}, async (t) => {
  const { page } = t;
  const models = `${t.project('ModelApp')}/assets/models`;
  const view = '.readme-view:not([hidden])';
  const facts = () => page.locator(`${view} .model-facts`).innerText().catch(() => '');
  const open = async (file) => {
    await (await t.reveal(file)).dblclick();
    await page.waitForFunction((selector) => {
      const shown = document.querySelector(selector);
      return shown && (!/Loading/.test(shown.querySelector('.model-facts')?.textContent ?? '') || shown.querySelector('.readme-status'));
    }, view, { timeout: 20000 }).catch(() => undefined);
  };
  // How the canvas looks: its colours counted, from a screenshot drawn into a 2D canvas.
  const look = async () => {
    // Off the buttons drawn over it, whose hover would change the picture.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    const shot = await page.locator(`${view} .model-canvas`).screenshot();
    return page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height });
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data: pixels } = context.getImageData(0, 0, image.width, image.height);
      const colors = new Set();
      for (let index = 0; index < pixels.length; index += 4 * 7) colors.add((pixels[index] >> 3) << 10 | (pixels[index + 1] >> 3) << 5 | (pixels[index + 2] >> 3));
      return { colors: colors.size, data };
    }, shot.toString('base64'));
  };
  // The picture once it has stopped changing (a texture arriving, the controls easing).
  const still = async () => {
    let last = await look();
    for (let tries = 0; tries < 20; tries += 1) {
      const now = await look();
      if (now.data === last.data) return now;
      last = now;
    }
    return last;
  };
  page.setDefaultTimeout(10000);
  // Software WebGL (SwiftShader) is what draws here; without it every check below would only wait.
  const webgl = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
  if (!t.check('the browser offers WebGL (SwiftShader)', webgl)) return;
  await t.openProject('ModelApp');

  await open(`${models}/box.obj`);
  t.check('an OBJ opens drawn in a tab', await page.locator(`.editor-tab.active[data-path="${models}/box.obj"]`).count() === 1 && await page.locator(`${view} .model-canvas`).count() === 1);
  t.check('with what it is made of beneath', /^OBJ · Meshes 1 · Triangles 12 · Vertices [\d,]+ · Materials 1 · 2 × 2 × 2 · [\d.,]+\s?(kB|bytes?)/.test(await facts()), await facts());
  t.check('its MTL and texture found', await page.locator(`${view} .model-missing`).count() === 0);
  const box = await still();
  t.check('and drawn, its texture in colour', box.colors > 40, { colors: box.colors });

  // Reset View after turning it; Wireframe; Grid.
  const area = await page.locator(`${view} .model-canvas`).boundingBox();
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width / 2 + 160, area.y + area.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const turned = await still();
  await page.locator(`${view} .model-tool`, { hasText: 'Reset View' }).click();
  const reset = await still();
  t.check('dragging turns it, Reset View brings it back', turned.data !== box.data && reset.data === box.data);
  await page.locator(`${view} .model-tool`, { hasText: 'Wireframe' }).click();
  t.check('Wireframe draws its edges only', await page.locator(`${view} .model-tool`, { hasText: 'Wireframe' }).getAttribute('aria-pressed') === 'true' && (await still()).data !== box.data);
  await page.locator(`${view} .model-tool`, { hasText: 'Wireframe' }).click();
  await page.locator(`${view} .model-tool`, { hasText: 'Grid' }).click();
  t.check('Grid hides the floor grid', await page.locator(`${view} .model-tool`, { hasText: 'Grid' }).getAttribute('aria-pressed') === 'false' && (await still()).data !== box.data);

  await open(`${models}/cube/cube.gltf`);
  t.check('a glTF with its buffer (a space in its name) and its texture', /^GLTF · Meshes 1 · Triangles 12 · Vertices 24 · Materials 1 · 1 × 1 × 1/.test(await facts()) && await page.locator(`${view} .model-missing`).count() === 0, await facts());
  t.check('the texture on it', (await still()).colors > 40);
  for (const [file, pattern] of [['tetra.stl', /^STL · Meshes 1 · Triangles 4 · Vertices 12/], ['quad.ply', /^PLY · Meshes 1 · Triangles 2 · Vertices 4/]]) {
    await open(`${models}/${file}`);
    t.check(`${file.split('.').pop().toUpperCase()} too`, pattern.test(await facts()) && (await still()).colors > 3, await facts());
  }
  await open(`${models}/lost.obj`);
  t.check('a material it names but lacks is said, the model drawn anyway', /Not found: gone\.mtl/.test(await page.locator(`${view} .model-missing`).innerText().catch(() => '')) && /^OBJ · Meshes 1 · Triangles 1/.test(await facts()), await facts());
  await open(`${models}/broken.fbx`);
  t.check('a broken one says it cannot be shown', /The model could not be shown/.test(await page.locator(view).innerText()), await page.locator(view).innerText());

  // Split: both sides draw it. Closed: the canvases go.
  await open(`${models}/tetra.stl`);
  await page.locator(`.editor-tab[data-path="${models}/tetra.stl"]`).first().click({ button: 'right' });
  await t.contextItem('Split Right').click();
  await t.eventually('split, both sides draw it', () => page.locator('.readme-view:not([hidden]) .model-canvas').count(), (count) => count === 2);
  while (await page.locator('.editor-tab .tab-close').count()) await page.locator('.editor-tab .tab-close').first().click();
  await t.eventually('closed, nothing of them is left drawing', () => page.locator('.model-canvas').count(), (count) => count === 0);

  // Renamed: its tab follows. Deleted: it closes.
  await open(`${models}/quad.ply`);
  await (await t.reveal(`${models}/quad.ply`)).click();
  await page.keyboard.press('F2');
  await page.fill('#input-dialog-value', 'square.ply');
  await page.keyboard.press('Enter');
  await t.eventually('renamed, its tab follows', async () => [await page.locator(`.editor-tab[data-path="${models}/square.ply"]`).count(), await page.locator(`.editor-tab[data-path="${models}/quad.ply"]`).count()],
    (counts) => counts[0] === 1 && counts[1] === 0);
  await (await t.reveal(`${models}/square.ply`)).click();
  await page.keyboard.press('Delete');
  await t.confirm();
  await t.eventually('deleted, its tab closes', async () => !fs.existsSync(`${models}/square.ply`) && await page.locator(`.editor-tab[data-path="${models}/square.ply"]`).count() === 0, Boolean);

  // Opened again after a reload, as the project was left.
  await open(`${models}/cube/cube.gltf`);
  await t.settle(() => page.evaluate((root) => localStorage.getItem(`glist-studio-session:${root}`) ?? '', t.project('ModelApp')), (session) => session.includes('cube.gltf'));
  await t.load();
  await t.openProject('ModelApp');
  await t.eventually('after a reload, the model tab is back and drawn', async () => ({ tab: await page.locator(`.editor-tab[data-path="${models}/cube/cube.gltf"]`).count(), facts: await facts() }),
    (value) => value.tab === 1 && /^GLTF/.test(value.facts), 15000);
});
