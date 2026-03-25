export interface UniverseObject {
    id: string;
}

export interface Factory {
    energyConsumption: number;
    coreLoadConsumption: number;
    nbInputs: number;
}

export interface Resource extends UniverseObject {
    createdIn: Factory;
    requires: {input: Resource, amountPerCycle: number}[];
    productionCycle: {seconds: number, nbUnits: number};
}

export interface Universe {
    resources: Resource[];
    factories: Factory[];
}