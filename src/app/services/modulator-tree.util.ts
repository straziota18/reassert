/**
 * Pure utility functions for building minimal N-to-1 and 1-to-N modulator trees.
 * These have no Angular dependencies and can be imported by any service or component.
 */

import { Connection, FactoryCanvasNode, Modulator } from './model';

/** A reference to a specific output port on a canvas node. */
export interface NodeRef {
  node: FactoryCanvasNode;
  outputId: number;
}

export interface TreeResult {
  nodes: FactoryCanvasNode[];
  connections: Connection[];
}

/**
 * Merges N source outputs into a single stream using the fewest possible N-to-1 modulator nodes.
 *
 * Uses a **carry-chain** approach: the output of each merger becomes the first input of the next
 * one, with the remaining slots filled by fresh source nodes.
 * Example (7 sources, `[3-to-1, 5-to-1]`): `[s0…s4]→5-to-1(A)`, `[A, s5, s6]→3-to-1(B)`.
 */
export function buildManyToOneTree(
  sources: NodeRef[],
  mods: Modulator[],
  createModNode: (mod: Modulator, x: number, y: number) => FactoryCanvasNode,
  baseX: number,
  baseY: number,
): TreeResult & { output: NodeRef } {
  if (sources.length === 1) {
    return { nodes: [], connections: [], output: sources[0] };
  }
  if (mods.length === 0) {
    return { nodes: [], connections: [], output: sources[0] };
  }

  const allNodes: FactoryCanvasNode[] = [];
  const allConns: Connection[] = [];

  // Largest-first so the first merger drains as many sources as possible
  const sortedMods = [...mods].sort((a, b) => b.nbInputs - a.nbInputs);

  let remaining = [...sources];
  let carry: NodeRef | null = null;
  let nodeCount = 0;

  while (remaining.length > 0 || carry !== null) {
    const total = remaining.length + (carry ? 1 : 0);
    if (total <= 1) break; // nothing more to merge

    // Prefer the smallest modulator that can absorb everything in one shot
    const reverseSorted = [...sortedMods].reverse();
    const singleStepMod = reverseSorted.find(m => m.nbInputs >= total);
    const chosenMod = singleStepMod ?? sortedMods[0];

    // Fill the merger: [carry] + up to (nbInputs − 1 if carry, else nbInputs) fresh sources
    const carryCount = carry ? 1 : 0;
    const freshCount = Math.min(chosenMod.nbInputs - carryCount, remaining.length);
    const freshSources = remaining.splice(0, freshCount);
    const inputs: NodeRef[] = carry ? [carry, ...freshSources] : freshSources;

    const modNode = createModNode(chosenMod, baseX + nodeCount * 110, baseY);
    nodeCount++;
    allNodes.push(modNode);

    for (let j = 0; j < inputs.length; j++) {
      allConns.push({
        id: crypto.randomUUID(),
        fromId:       inputs[j].node.id,
        fromOutputId: inputs[j].outputId,
        toId:         modNode.id,
        toInputId:    j,
      });
    }

    carry = { node: modNode, outputId: 0 };
  }

  return { nodes: allNodes, connections: allConns, output: carry! };
}

/**
 * Splits a single source stream into M output references using the fewest possible 1-to-N
 * modulator nodes.
 *
 * Uses a **last-output-chains** approach: when a single splitter cannot serve all remaining
 * consumers, all outputs except the *last* feed consumers directly; the *last* output chains into
 * the *input* of the next splitter.
 *
 * Example (M=5, `[1-to-3]` only):
 * ```
 * source → 1-to-3(A): out0 → consumer1
 *                      out1 → consumer2
 *                      out2 → 1-to-3(B): out0 → consumer3
 *                                         out1 → consumer4
 *                                         out2 → consumer5
 * ```
 */
export function buildOneToManyTree(
  source: NodeRef,
  M: number,
  mods: Modulator[],
  createModNode: (mod: Modulator, x: number, y: number) => FactoryCanvasNode,
  baseX: number,
  baseY: number,
): TreeResult & { outputs: NodeRef[] } {
  if (M <= 1) {
    return { nodes: [], connections: [], outputs: [source] };
  }
  if (mods.length === 0) {
    return { nodes: [], connections: [], outputs: [source] };
  }

  const allNodes: FactoryCanvasNode[] = [];
  const allConns: Connection[] = [];
  const outputs: NodeRef[] = [];

  // Largest-first so each splitter covers as many consumers as possible per step
  const sortedMods = [...mods].sort((a, b) => b.nbOutputs - a.nbOutputs);

  let remaining    = M;
  let currentInput = source;
  let nodeCount    = 0;

  while (remaining > 0) {
    if (remaining === 1) {
      // Last consumer receives the current input directly — no splitter needed
      outputs.push(currentInput);
      break;
    }

    // Find the smallest splitter that can serve ALL remaining consumers in one shot
    const reverseSorted = [...sortedMods].reverse();
    const singleShotMod = reverseSorted.find(m => m.nbOutputs >= remaining);

    if (singleShotMod) {
      const modNode = createModNode(singleShotMod, baseX + nodeCount * 110, baseY);
      nodeCount++;
      allNodes.push(modNode);
      allConns.push({
        id: crypto.randomUUID(),
        fromId:       currentInput.node.id,
        fromOutputId: currentInput.outputId,
        toId:         modNode.id,
        toInputId:    0,
      });
      for (let i = 0; i < remaining; i++) {
        outputs.push({ node: modNode, outputId: i });
      }
      remaining = 0;
    } else {
      // Use the largest available splitter.
      // All outputs except the last become direct consumer feeds;
      // the last output chains into the next splitter's input.
      const chosenMod   = sortedMods[0];
      const directCount = chosenMod.nbOutputs - 1;

      const modNode = createModNode(chosenMod, baseX + nodeCount * 110, baseY);
      nodeCount++;
      allNodes.push(modNode);
      allConns.push({
        id: crypto.randomUUID(),
        fromId:       currentInput.node.id,
        fromOutputId: currentInput.outputId,
        toId:         modNode.id,
        toInputId:    0,
      });

      for (let i = 0; i < directCount; i++) {
        outputs.push({ node: modNode, outputId: i });
      }
      remaining   -= directCount;
      currentInput = { node: modNode, outputId: chosenMod.nbOutputs - 1 };
    }
  }

  return { nodes: allNodes, connections: allConns, outputs };
}
