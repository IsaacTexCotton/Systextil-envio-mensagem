#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const USERSCRIPTS_DIR = path.join(ROOT, "userscripts");
const MAJOR_NODE = Number.parseInt(process.versions.node.split(".")[0], 10);
const MAX_BUFFER = 10 * 1024 * 1024;

function listarUserscripts(diretorio) {
  const arquivos = [];

  for (const item of fs.readdirSync(diretorio, { withFileTypes: true })) {
    const caminho = path.join(diretorio, item.name);

    if (item.isDirectory()) {
      arquivos.push(...listarUserscripts(caminho));
    } else if (item.isFile() && item.name.endsWith(".user.js")) {
      arquivos.push(caminho);
    }
  }

  return arquivos.sort((a, b) => a.localeCompare(b, "en"));
}

function executarNode(argumentos) {
  return spawnSync(process.execPath, argumentos, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
}

function exibirSaida(resultado) {
  if (resultado.stdout) process.stdout.write(resultado.stdout);
  if (resultado.stderr) process.stderr.write(resultado.stderr);
}

function main() {
  console.log("Verificação local — Systextil");
  console.log("Node.js " + process.version);

  if (!Number.isInteger(MAJOR_NODE) || MAJOR_NODE < 18) {
    console.error("FALHA: este projeto exige Node.js 18 ou superior.");
    process.exitCode = 1;
    return;
  }

  let userscripts;
  try {
    userscripts = listarUserscripts(USERSCRIPTS_DIR);
  } catch (erro) {
    console.error("FALHA: não foi possível listar os userscripts: " + erro.message);
    process.exitCode = 1;
    return;
  }

  if (userscripts.length === 0) {
    console.error("FALHA: nenhum arquivo *.user.js foi encontrado em userscripts/.");
    process.exitCode = 1;
    return;
  }

  console.log("\n[1/2] Verificando sintaxe de " + userscripts.length + " userscript(s)...");

  let sintaxeAprovada = true;
  for (const arquivo of userscripts) {
    const relativo = path.relative(ROOT, arquivo);
    const resultado = executarNode(["--check", arquivo]);

    if (resultado.error) {
      console.error("FALHA: não foi possível verificar " + relativo + ": " + resultado.error.message);
      sintaxeAprovada = false;
      continue;
    }

    exibirSaida(resultado);

    if (resultado.status !== 0) {
      console.error("FALHA de sintaxe: " + relativo);
      sintaxeAprovada = false;
    } else {
      console.log("OK: " + relativo);
    }
  }

  if (!sintaxeAprovada) {
    console.error("\nVerificação interrompida: corrija os erros de sintaxe antes dos testes.");
    process.exitCode = 1;
    return;
  }

  console.log("\n[2/2] Executando a suíte completa (node --test)...");
  const testes = executarNode(["--test"]);

  if (testes.error) {
    console.error("FALHA: não foi possível iniciar a suíte de testes: " + testes.error.message);
    process.exitCode = 1;
    return;
  }

  exibirSaida(testes);

  if (testes.status !== 0) {
    console.error("\nFALHA: a suíte de testes retornou código " + String(testes.status) + ".");
    process.exitCode = testes.status || 1;
    return;
  }

  console.log("\nAPROVADO: sintaxe dos userscripts e suíte completa de testes.");
}

main();
