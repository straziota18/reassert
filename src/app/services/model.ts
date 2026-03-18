export interface UniverseObject {
    id: string;
}

export interface Factory {
    energyConsumption?: number;
    coreLoadConsumption?: number;
}

export interface Resource extends UniverseObject {
    createdIn: Factory;
    requires: Resource[];
    productionPerMinute: number;
}

export interface Universe {
    resources: Resource[];
    factories: Factory[];
}