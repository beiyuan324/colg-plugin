import fs from 'node:fs';
import _ from 'lodash';
import YAML from 'yaml';
import chokidar from 'chokidar';
import Base from './base.js';

class ColgConfig extends Base {
  constructor(e) {
    super(e);
    this.configPath = `./plugins/${ColgConfig.pluginName}/config/`;
    this.previousContent = new Map();
  }

  getConfig(name) {
    return this.getYaml(name);
  }

  getField(name, field) {
    const config = this.getConfig(name);
    return config?.[field];
  }

  updateField(name, field, value) {
    const config = this.getConfig(name) || {};
    config[field] = value;
    logger.mark(`[COLG插件][修改配置项][${name}][${field}] 修改为：${value}`);
    this.saveAllConfig(name, config);
  }

  deleteField(name, field) {
    const config = this.getConfig(name) || {};
    delete config[field];
    this.saveAllConfig(name, config);
  }

  getYaml(name, isWatch = true) {
    const file = this.getFilePath(name);
    if (!fs.existsSync(file)) return {};
    const yaml = YAML.parse(fs.readFileSync(file, 'utf8'));

    if (isWatch) {
      this.previousContent.set(name, yaml);
      this.watch(file, name);
    }
    return yaml;
  }

  getFilePath(name) {
    return `${this.configPath}${name}.yaml`;
  }

  watch(file, name) {
    const watcher = chokidar.watch(file);

    watcher.on('change', path => {
      const currentContent = YAML.parse(fs.readFileSync(path, 'utf8'));
      const previousContent = this.previousContent.get(name);

      if (!_.isEqual(previousContent, currentContent)) {
        logger.mark(`[COLG插件][配置文件]：${name} 已经被重置`);
        this.previousContent.set(name, currentContent);
      }
    });
  }

  saveAllConfig(name, data) {
    const file = this.getFilePath(name);
    if (_.isEmpty(data)) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } else {
      const yaml = YAML.stringify(data);
      fs.mkdirSync(this.configPath, { recursive: true });
      fs.writeFileSync(file, yaml, 'utf8');
    }
    this.watch(file, name);
  }
}

export default new ColgConfig();
