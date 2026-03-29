import { computed, signal, Signal, WritableSignal } from '@angular/core';
import * as _ from 'lodash';

export interface ReassertObject {
    id: string;
}

export interface Factory extends ReassertObject {
    energyConsumption: number;
    coreLoadConsumption: number;
    nbInputs: number;
}

export interface ActiveFactory extends Factory {
    activeRecipe: WritableSignal<Resource | null>;
}

export interface VirtualFactory extends ReassertObject {
    /** The id of the FactoryLayout this virtual factory belongs to. */
    layoutId: string;
    outputs: {resource: Resource, amountPerMinute: number}[];
}

export const createActiveFactory: (factory: Factory, activeRecipe: Resource | null) => ActiveFactory = (factory, activeRecipe) => {
    return {
        id: factory.id,
        nbInputs: factory.nbInputs,
        energyConsumption: factory.energyConsumption,
        coreLoadConsumption: factory.coreLoadConsumption,
        activeRecipe: signal(activeRecipe)
    };
};

export interface Resource extends ReassertObject {
    createdIn: Factory;
    requires: {input: Resource, amountPerCycle: number}[];
    productionCycle: {seconds: number, nbUnits: number};
}

export interface Universe {
    resources: {[id: string]: Resource};
    factories: {[id: string]: Factory};
}

export interface FactoryCanvasNode extends ReassertObject {
  factory: ActiveFactory | VirtualFactory;
  x: number;
  y: number;
  /** Always {0,0} at rest; accumulates CDK transform during a drag, then absorbed into x/y on drop. */
  freeDragPos: { x: number; y: number };
  activeFormula: Signal<string>
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

export const isActiveFactory: (node: FactoryCanvasNode) => boolean = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs');
};

export const isMissingFormula: (node: FactoryCanvasNode) => boolean = (node: FactoryCanvasNode) => {
    return !_.hasIn(node, 'outputs') ? (<ActiveFactory>node.factory).activeRecipe === null : false;
};

export interface Connection extends ReassertObject {
  fromId: string;
  fromOutputId: number;
  toId: string;
  toInputId: number;
}

export interface FactoryLayout extends ReassertObject {
    factories: WritableSignal<FactoryCanvasNode[]>;
    connections: WritableSignal<Connection[]>;
}