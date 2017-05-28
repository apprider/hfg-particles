import Effect, { ConfigUI, fract } from './effect';
import { parseHtml } from '../ui/util';

class ConvergeCircleConfigUI extends ConfigUI {
  constructor() {
    super();
    this.element = parseHtml(`
      <fieldset>
        <legend>Converge</legend>
        <label>
          Speed:
          <input type="number" class="effect-converge-speed" value="100" />
        </label><br/>
        <label>
          Rotation speed:
          <input type="number" class="effect-converge-rotation-speed" value="0" />
        </label>
      </fieldset>
    `);
    const ui = this.element;

    this.rotationSpeedInput = ui.querySelector('input.effect-converge-rotation-speed');
    this.speedInput = ui.querySelector('input.effect-converge-speed');
    this.speedInput.addEventListener('change', () => {
      this.notifyChange();
    });
    this.rotationSpeedInput.addEventListener('change', () => {
      this.notifyChange();
    });
  }

  getElement() {
    return this.element;
  }

  getConfig() {
    const config = {};
    config.rotationSpeed = parseInt(this.rotationSpeedInput.value, 10) / 100;
    config.speed = parseInt(this.speedInput.value, 10) / 1000;

    return config;
  }

  applyConfig(config) {
    this.rotationSpeedInput.checked = config.rotationSpeed * 100;
    this.speedInput.checked = config.speed * 1000;
  }
}

export default class ConvergeCircleEffect extends Effect {
  static register(instance, uniforms, vertexShader) {
    const time = uniforms.addUniform('convergeTime', 'float', (ctx) => {
      const period = 2 * Math.sqrt(2 / instance.config.speed);

      return fract(ctx.time / period) * period;
    });
    const speed = uniforms.addUniform('convergeSpeed', 'float', () => instance.config.speed);
    const rotationSpeed = uniforms.addUniform('convergeRotationSpeed', 'float', () => instance.config.rotationSpeed);
    const maxTravelTime = uniforms.addUniform('convergeMaxTravelTime', 'float', () => Math.sqrt(2 / instance.config.speed));

    // eslint-disable-next-line no-param-reassign
    vertexShader.mainBody += `
      {
        vec2 screenTarget = getDirectionVector(hsv[0] + ${time} * ${rotationSpeed}) * vec2(.8) * vec2(invScreenAspectRatio, 1.);
        vec2 target = (invViewProjectionMatrix * vec4(screenTarget, 0, 1)).xy;

        vec2 d = target - initialPosition.xy;
        float d_len = length(d);
        
        float stop_t = sqrt(2. * d_len / ${speed});

        if(${time} < stop_t) {
          float t = min(${time}, stop_t);
          position.xy += .5 * d / d_len * ${speed} * t * t;
        } else if(${time} < ${maxTravelTime}) {
          position.xy += d;
        } else {
          float t = ${time} - ${maxTravelTime};
          //position.xy += mix(d, vec2(0.), 1. - (1.-t) * (1.-t));
          //position.xy += mix(d, vec2(0.), t * t);
          position.xy += mix(d, vec2(0.), -cos(t / ${maxTravelTime} * PI) * .5 + .5);
        }
      }
    `;
  }

  static getDisplayName() {
    return 'Converge to circle';
  }

  static getConfigUI() {
    if (!this._configUI) {
      this._configUI = new ConvergeCircleConfigUI();
    }

    return this._configUI;
  }

  static getDefaultConfig() {
    return {
      rotationSpeed: 0,
      speed:         0.1,
    };
  }
}