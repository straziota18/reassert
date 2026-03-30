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

export interface Modulator extends ReassertObject {
    nbInputs: number;
    nbOutputs: number;
}

export interface VirtualFactory extends ReassertObject {
    outputs: { resource: Resource, amountPerMinute: number }[];
}

export const virtualFactoryActiveRecipeSignal: (vf: VirtualFactory) => Signal<string[]> = (vf) => {
    return signal(vf.outputs.map(o => o.resource.id));
};

export interface ActiveFactory extends Factory {
    activeRecipe: WritableSignal<Resource | null>;
    /** Name of the selected ProductionVariant, or null to use the default productionCycle. */
    activeProductionVariant: WritableSignal<string | null>;
}

export interface ProductionVariant {
    name: string;
    seconds: number;
    nbUnits: number;
}

export const createActiveFactory: (factory: Factory, activeRecipe: Resource | null) => ActiveFactory = (factory, activeRecipe) => {
    return {
        id: factory.id,
        nbInputs: factory.nbInputs,
        energyConsumption: factory.energyConsumption,
        coreLoadConsumption: factory.coreLoadConsumption,
        activeRecipe: signal(activeRecipe),
        activeProductionVariant: signal(null),
    };
};

export const activeFactoryActiveRecipeSignal: (af: ActiveFactory) => Signal<string[]> = (af) => {
    return computed(() => {
        const activeRecipe = af.activeRecipe();
        if (activeRecipe === null) return [];
        const variant = af.activeProductionVariant();
        return [variant ? `${activeRecipe.id} [${variant}]` : activeRecipe.id];
    });
};

export interface Resource extends ReassertObject {
    createdIn: Factory;
    requires: { input: Resource, amountPerCycle: number }[];
    productionCycle: { seconds: number, nbUnits: number };
    /** Optional alternative yield variants (e.g. Impure / Pure ore nodes). */
    productionVariants?: ProductionVariant[];
}

export interface Universe {
    resources: { [id: string]: Resource };
    factories: { [id: string]: Factory };
    modulators: { [id: string]: Modulator };
}

export interface FactoryCanvasNode extends ReassertObject {
    factory: ActiveFactory | VirtualFactory | Modulator;
    x: number;
    y: number;
    /** Always {0,0} at rest; accumulates CDK transform during a drag, then absorbed into x/y on drop. */
    freeDragPos: { x: number; y: number };
    activeFormula: Signal<string[]>
}

export const getNbInputs: (node: FactoryCanvasNode) => number = (node) => {
    if (isVirtualLayout(node)) {
        return 0;
    }
    if (isModulator(node)) {
        return (node.factory as Modulator).nbInputs;
    }
    return (node.factory as ActiveFactory).nbInputs;
};

export const getNbOutputs: (node: FactoryCanvasNode) => number = (node) => {
    if (isVirtualLayout(node)) {
        return (node.factory as VirtualFactory).outputs.length;
    }
    if (isModulator(node)) {
        return (node.factory as Modulator).nbOutputs;
    }
    return 1;
};

export const getNodeLabel: (node: FactoryCanvasNode) => string = (node) => {
    return isVirtualLayout(node) ? 'Virtual source' : (<ActiveFactory>node.factory).id;
};

export const isVirtualLayout: (node: FactoryCanvasNode) => boolean = (node) => {
    return _.hasIn(node.factory, 'outputs');
};

export const isModulator: (node: FactoryCanvasNode) => boolean = (node) => {
    return _.hasIn(node.factory, 'nbInputs') && _.hasIn(node.factory, 'nbOutputs');
}

export const isActiveFactory: (node: FactoryCanvasNode) => boolean = (node) => {
    return !(isModulator(node) || isVirtualLayout(node));
}

export const isMissingFormula: (node: FactoryCanvasNode) => boolean = (node: FactoryCanvasNode) => {
    return isActiveFactory(node) ? (node.factory as ActiveFactory).activeRecipe() === null : false;
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
    targets: WritableSignal<{ [resourceId: string]: { target: number, resource: Resource } }>;
}

export const modulatorActiveRecipeSignal: (layout: FactoryLayout, factoryCanvasId: string) => Signal<string[]> = (layout, factoryCanvasId) => {
    return computed(() => {
        return _.uniq(_.concat(layout.connections()
            .filter(c => c.toId === factoryCanvasId)
            .flatMap(c => layout.factories().find(f => f.id === c.fromId)!.activeFormula())
        ));
    });
};