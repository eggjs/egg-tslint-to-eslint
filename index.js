#!/usr/bin/env node

'use strict';

const fs = require('mz').fs;
const mkdirp = require('mz-modules').mkdirp;
const path = require('path');
const { Confirm } = require('enquirer');
const assert = require('assert');
const chalk = require('chalk').default;
const runscript = require('runscript');
const jsYaml = require('js-yaml');
const { converters } = require('tslint-to-eslint-config/src/rules/converters');
const { convertRule } = require('tslint-to-eslint-config/src/rules/convertRule');
const argv = process.argv;

main(process.cwd());

async function main(cwd) {
  // check tsconfig
  const tsconfigFile = path.resolve(cwd, 'tsconfig.json');
  assert(await fs.exists(tsconfigFile), `${tsconfigFile} not found`);

  // check package.json
  const packageFile = path.resolve(cwd, 'package.json');
  assert(await fs.exists(packageFile), `${packageFile} not found`);

  // load tslint rules and convert to eslint rules
  const tslintConfigFile = path.resolve(cwd, './tslint.json');
  const tslintRules = await getTsLintCustomRules(cwd, tslintConfigFile);
  const newRules = await convertRules(tslintRules);

  // create tsconfig.eslint.json
  const tslintEslintName = 'tsconfig.eslint.json';
  const tsconfigEslint = {
    extends: './tsconfig.json',
    include: [
      'app/**/*.ts',
      'config/**/*.ts',
      'test/**/*.ts',
      'src/**/*.ts',
    ],
  };
  await fs.writeFile(path.resolve(cwd, tslintEslintName), JSON.stringify(tsconfigEslint, null, 2));

  // create eslint file and migrate rules
  const eslintFile = path.resolve(cwd, '.eslintrc');
  const eslintConfig = {
    extends: 'eslint-config-egg/typescript',
    parserOptions: {
      project: `./${tslintEslintName}`,
    },
  };
  if (newRules) eslintConfig.rules = newRules;

  // create eslintignore file
  const eslintignoreFile = path.resolve(cwd, './.eslintignore');
  const existContentList = (await fs.exists(eslintignoreFile)) ? await fs.readFile(eslintignoreFile, 'utf-8') : '';
  const eslintIgnore = [
    'dist/',
    '**/*.d.ts',
    'node_modules/',
  ].join('\n');

  // delete tslint.json
  if (await confirm('Should remove tslint.json?')) {
    await fs.unlink(tslintConfigFile);
  }

  // check vscode
  if (await confirm('Are you working with vscode?')) {
    // update vscode setting.json
    const vscodeSettingFile = path.resolve(cwd, './.vscode/settings.json');
    const eslintValidateInfo = [
      'javascript',
      'javascriptreact',
      {
        language: 'typescript',
        autoFix: true,
      },
    ];
    const vscodeSetting = await loadConfig(vscodeSettingFile);
    vscodeSetting['eslint.validate'] = eslintValidateInfo;
    await mkdirp(path.dirname(vscodeSettingFile));
    await fs.writeFile(vscodeSettingFile, JSON.stringify(vscodeSetting, null, 2));

    // should add createDefaultProgram: true to eslintrc in vscode
    // @see https://github.com/typescript-eslint/typescript-eslint/issues/864#issuecomment-523213273
    eslintConfig.parserOptions.createDefaultProgram = true;
  }

  // update deps
  if (await confirm('Should auto update package.json?')) {
    const pkgInfo = await loadConfig(packageFile);
    pkgInfo.scripts = pkgInfo.scripts || {};
    pkgInfo.devDependencies = pkgInfo.devDependencies || {};
    pkgInfo.scripts.lint = 'eslint . --ext .ts';
    pkgInfo.devDependencies.eslint = '^6.0.0';
    pkgInfo.devDependencies['eslint-config-egg'] = '^7.0.0';
    delete pkgInfo.devDependencies['tslint-config-egg'];
    delete pkgInfo.devDependencies.tslint;
    await fs.writeFile(packageFile, JSON.stringify(pkgInfo, null, 2));
  }

  // write eslint file
  await fs.writeFile(eslintFile, JSON.stringify(eslintConfig, null, 2));
  await fs.writeFile(eslintignoreFile, `${existContentList}\n\n${eslintIgnore}`);
}

function confirm(msg) {
  if (argv.includes('-y')) {
    return true;
  }

  const prompt = new Confirm({
    name: 'question',
    message: msg,
    initial: 'y',
  });

  process.send && process.send({ type: 'prompt' });
  return prompt.run();
}

async function convertRules(rules) {
  const newRules = {};
  const newRulesConverter = Object.keys(rules).map(ruleName => {
    const rule = rules[ruleName];
    return {
      ruleName,
      result: convertRule({ ...rule, ruleName }, converters),
    };
  });

  const notSupportRules = [];
  newRulesConverter
    .forEach(({ ruleName, result }) => {
      if (!result || result.error) {
        notSupportRules.push(ruleName);
        return;
      }

      result.rules.forEach(rule => {
        newRules[rule.ruleName] = rule.ruleArguments || 'off';
      });
    });

  if (notSupportRules.length) {
    warn('\nThese rules is still not support in typescript-eslint');
    warn(`\n${notSupportRules.map(r => `  ${r}`).join('\n')}\n`);
    if (!(await confirm('Continue to convert? these rules will be dropped'))) {
      process.exit(0);
    }
  }

  return Object.keys(newRules).length ? newRules : undefined;
}

function warn(msg) {
  console.info(chalk.yellow(msg));
}

async function loadConfig(file) {
  if (!await fs.exists(file)) return {};
  const content = await fs.readFile(file, 'utf-8');
  const extname = path.extname(file);
  if (extname === '.json' || content.trim().startsWith('{')) {
    return JSON.parse(content) || {};
  } else if (extname === '.js') {
    return require(file);
  }

  return jsYaml.safeLoad(content, { json: true }) || {};
}

async function getTsLintCustomRules(cwd, tslintConfigFile) {
  const { stdout } = await runscript(`tslint --print-config ${tslintConfigFile}`, { stdio: 'pipe' }).catch(() => ({}));
  const tslintConfig = stdout ? JSON.parse(stdout) : undefined;
  const { rules: codeRules } = await loadConfig(path.resolve(cwd, './tslint.json'));
  const rules = {};
  if (tslintConfig && codeRules) {
    const allRules = { ...tslintConfig.jsRules, ... tslintConfig.rules };
    Object.keys(codeRules).forEach(ruleName => {
      if (allRules[ruleName]) rules[ruleName] = allRules[ruleName];
    });
  }
  return rules;
}
