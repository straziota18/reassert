import { computed, signal, Signal, WritableSignal } from '@angular/core';
import * as _ from 'lodash';

export interface UniverseObject {
    id: string;
}

export interface Factory extends UniverseObject {
    energyConsumption: number;
    coreLoadConsumption: number;
    nbInputs: number;
}

export interface ActiveFactory extends Factory {
    activeRecipe: WritableSignal<Resource>;
}

export interface VirtualFactory extends UniverseObject {
    outputs: {resource: Resource, amountPerMinute: number}[];
}

export interface FactoryCanvasNode extends UniverseObject {
  factory: ActiveFactory | VirtualFactory;
  x: number;
  y: number;
  /** Always {0,0} at rest; accumulates CDK transform during a drag, then absorbed into x/y on drop. */
  freeDragPos: { x: number; y: number };
}

export const getNbInputs: (node: FactoryCanvasNode) => number = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs') ? (<ActiveFactory>node.factory).nbInputs : 1;
};

export const getNbOutputs: (node: FactoryCanvasNode) => number = (node: FactoryCanvasNode) => {
    return _.hasIn(node, 'outputs') ? (<VirtualFactory>node.factory).outputs.length : 1;
};

export const getNodeLabel: (node: FactoryCanvasNode) => string = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs') ? (<ActiveFactory>node.factory).id : 'Virtual source';
};

export const getActiveFormulaSignal: (node: FactoryCanvasNode) => Signal<string> = (node: FactoryCanvasNode) => {
    if (_.hasIn(node, 'outputs')) {
        return signal('Virtual source');
    }
    return computed(() => {
        const activeRecipe = (<ActiveFactory>node.factory).activeRecipe();
        return activeRecipe === null ? 'No recipe selected' : activeRecipe.id;
    });
};

export const isActiveFactory: (node: FactoryCanvasNode) => boolean = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs');
};

export const isMissingFormula: (node: FactoryCanvasNode) => boolean = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs') ? (<ActiveFactory>node.factory).activeRecipe === null : false;
};

export interface Resource extends UniverseObject {
    createdIn: Factory;
    requires: {input: Resource, amountPerCycle: number}[];
    productionCycle: {seconds: number, nbUnits: number};
}

export interface Universe {
    resources: {[id: string]: Resource};
    factories: {[id: string]: Factory};
}

export interface Connection extends UniverseObject {
  fromId: string;
  fromOutputId: number;
  toId: string;
  toInputId: number;
}

export interface FactoryLayout {

}