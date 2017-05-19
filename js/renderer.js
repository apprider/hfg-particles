import createRegl from 'regl';
import CommandBuilder from './command-builder';

export default class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.regl = createRegl({ canvas });
    console.log(`max texture size: ${this.regl.limits.maxTextureSize}`);
    console.log(`point size dims: ${this.regl.limits.pointSizeDims[0]} ${this.regl.limits.pointSizeDims[1]}`);
    console.log(`max uniforms: ${this.regl.limits.maxVertexUniforms} ${this.regl.limits.maxFragmentUniforms}`);
    this.particleData = null;
    this.state = null;
    this.command = null;
    this.commandBuilder = new CommandBuilder();
    this.oldTime = this.regl.now();
    this.currentTime = this.regl.now();
    this.regl.frame(() => {
      this.oldTime = this.currentTime;
      this.currentTime = this.regl.now();
      if (this.command === null) {
        return;
      }
      this.regl.clear({ color: this.state.backgroundColor });
      this.command({
        state: this.state,
        particleData: this.particleData,
        oldTime: this.oldTime,
        currentTime: this.currentTime,
      });
    });
  }

  loadImageData(img) {
    const fullresCanvas = document.createElement('canvas');
    const fullresContext = fullresCanvas.getContext('2d');
    fullresCanvas.width = img.naturalWidth;
    fullresCanvas.height = img.naturalHeight;
    // flipped y-axis
    fullresContext.translate(0, img.naturalHeight);
    fullresContext.scale(1, -1);
    fullresContext.drawImage(img, 0, 0);
    this.imgData = fullresCanvas;
  }

  createParticleData() {
    this.destroyParticleData();
    
    const imgData = this.imgData;
    const scalingCanvas = document.createElement('canvas');
    const scalingContext = scalingCanvas.getContext('2d');
    scalingCanvas.width = this.state.xParticlesCount || imgData.width;
    scalingCanvas.height = this.state.yParticlesCount || imgData.height;
    scalingContext.drawImage(imgData, 0, 0, scalingCanvas.width, scalingCanvas.height);
    const scaledData = scalingContext.getImageData(0, 0, scalingCanvas.width, scalingCanvas.height);

    const w = scaledData.width;
    const h = scaledData.height;

    const particlePixels = scaledData.data;

    const pixelIndices = Array.from(Array(w * h).keys());

    const texcoords = pixelIndices.map((i) => [((i % w) + 0.5) / w, (Math.floor(i / w) + 0.5) / h]);

    const rgb = pixelIndices.map((i) => {
      const pixel = particlePixels.slice(i * 4, (i * 4) + 4);

      return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
    });

    const hsv = pixelIndices.map((i) => {
      const pixel = rgb[i];

      const cMax = Math.max(pixel[0], pixel[1], pixel[2]);
      const cMin = Math.min(pixel[0], pixel[1], pixel[2]);
      const d = cMax - cMin;

      if (d < 0.00001 || cMax < 0.00001) {
        return [0, 0, cMax];
      }

      let _h;
      if (cMax === pixel[0]) {
        _h = (pixel[1] - pixel[2]) / d;
        if (_h < 0) {
          _h += 6;
        }
      } else if (cMax === pixel[1]) {
        _h = ((pixel[2] - pixel[0]) / d) + 2;
      } else {
        _h = ((pixel[0] - pixel[1]) / d) + 4;
      }

      return [_h * 60 * (Math.PI / 180), d / cMax, cMax];
    });

    this.particleData = {
      width: w,
      height: h,
      aspectRatio: imgData.width / imgData.height,
      texcoordsBuffer: this.regl.buffer(texcoords),
      rgbBuffer: this.regl.buffer(rgb),
      hsvBuffer: this.regl.buffer(hsv)
    };
  }

  destroyParticleData() {
    this.command = null;
    if (this.particleData !== null) {
      this.particleData.texcoordsBuffer.destroy();
      this.particleData.rgbBuffer.destroy();
      this.particleData.hsvBuffer.destroy();
      this.particleData = null;
    }
  }

  rebuildCommand() {
    const cmd = this.commandBuilder.rebuildCommand(this.particleData, this.state);
    this.command = this.regl(cmd);
  }

  loadImage(img) {
    this.loadImageData(img);
    this.createParticleData();
    this.rebuildCommand();
  }

  setState(state) {
    const oldState = this.state;
    this.state = state;
    // TODO: rebuild command only when necessary
    this.createParticleData();
    this.rebuildCommand();
  }
}