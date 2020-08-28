'use strict';

const fs = require('mz').fs;
const path = require('path');
const assert = require('assert');
const coffee = require('coffee');
const runscript = require('runscript');

describe('test/index.test.js', () => {
  const cmd = path.resolve(__dirname, '../index.js');
  const tmp = path.resolve(__dirname, './fixtures/.tmp');

  beforeEach(() => runscript(`rm -rf ${tmp}`));

  async function getConfig(url) {
    const eslintContent = await fs.readFile(url, 'utf-8');
    return JSON.parse(eslintContent);
  }

  it('should works without error', async () => {
    const dir = path.resolve(__dirname, './fixtures/app');
    await runscript(`cp -R ${dir} ${tmp}`);
    await coffee.fork(cmd, [ '-y' ], { cwd: tmp })
      // .debug()
      .expect('code', 0)
      .end();

    assert(await fs.exists(path.resolve(tmp, '.eslintrc')));
    assert(await fs.exists(path.resolve(tmp, '.vscode/settings.json')));
    assert(await fs.exists(path.resolve(tmp, 'tsconfig.eslint.json')));
    assert(await fs.exists(path.resolve(tmp, 'package.json')));

    // check eslintrc
    const eslintConfig = await getConfig(path.resolve(tmp, '.eslintrc'));
    assert(eslintConfig.extends === 'eslint-config-egg/typescript');
    assert(eslintConfig.parserOptions.project === './tsconfig.eslint.json');
    assert(eslintConfig.parserOptions.createDefaultProgram);
    assert(eslintConfig.rules['@typescript-eslint/adjacent-overload-signatures'] === 'off');
    assert(eslintConfig.rules['@typescript-eslint/member-ordering'] === 'off');

    // check vscode
    const vscodeSetting = await getConfig(path.resolve(tmp, '.vscode/settings.json'));
    assert(vscodeSetting['eslint.validate'].find(rule => rule.language === 'typescript'));

    // check tsconfig
    const tsconfigEslint = await getConfig(path.resolve(tmp, 'tsconfig.eslint.json'));
    assert(tsconfigEslint.include);

    // check package.json
    const pkgInfo = await getConfig(path.resolve(tmp, 'package.json'));
    assert(pkgInfo.scripts.lint.includes('eslint . --ext .ts'));
    assert(pkgInfo.devDependencies.eslint);
    assert(pkgInfo.devDependencies['eslint-config-egg']);
    assert(!pkgInfo.devDependencies.tslint);
    assert(!pkgInfo.devDependencies['tslint-config-egg']);
  });

  it('should works with prompt without error', async () => {
    const dir = path.resolve(__dirname, './fixtures/app');
    await runscript(`cp -R ${dir} ${tmp}`);
    await coffee.fork(cmd, { cwd: tmp })
      .debug()
      .waitForPrompt()
      .write('\n')
      .write('N\n')
      .write('N\n')
      .write('N\n')
      .expect('code', 0)
      .end();

    // should not change package.json
    const pkgInfo = await getConfig(path.resolve(tmp, 'package.json'));
    assert(pkgInfo.scripts.lint.includes('tslint'));
    assert(!pkgInfo.devDependencies.eslint);
    assert(!pkgInfo.devDependencies['eslint-config-egg']);
  });

  it('should works with empty rule without error', async () => {
    const dir = path.resolve(__dirname, './fixtures/app2');
    await runscript(`cp -R ${dir} ${tmp}`);
    await coffee.fork(cmd, [ '-y' ], { cwd: tmp })
      .debug()
      .expect('code', 0)
      .end();

    // check eslintrc
    const eslintConfig = await getConfig(path.resolve(tmp, '.eslintrc'));
    assert(eslintConfig.extends === 'eslint-config-egg/typescript');
    assert(eslintConfig.parserOptions.project === './tsconfig.eslint.json');
    assert(!eslintConfig.rules);
  });
});
