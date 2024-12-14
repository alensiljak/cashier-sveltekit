import { Account } from '$lib/data/model'
import Big from 'big.js'

export class AssetClass {
  fullname: string
  allocation = 0
  allocatedValue = Big(0)
  currentAllocation = 0
  currentValue = Big(0)
  diff = 0
  diffAmount = 0
  diffPerc = 0
  currency = ''
  symbols: string[] = []

  constructor() {
    this.fullname = ''
    // this.level = null; // the depth level, with root Allocation = 0
  }

  /**
   * Represents the class depth in the allocation tree.
   * The root element (Allocation) is 0. This is effectively the number of parents.
   */
  get depth() {
    if (!this.parentName) return 0

    const parents = this.parentName.split(':')
    return parents.length
  }

  //   get fullname() {
  //     return this.full_name;
  //   }

  //   set fullname(value) {
  //     this.full_name = value;

  //     //
  //     let parts = value.split(":");
  //     let lastIndex = parts.length - 1;
  //     this.name = parts[lastIndex];
  //     parts.splice(lastIndex, 1);

  //     this.parentname = parts.join(":");
  //   }

  get name() {
    const parts = this.fullname.split(':')
    const lastIndex = parts.length - 1
    return parts[lastIndex]
  }

  get parentName() {
    const parts = this.fullname.split(':')
    const lastIndex = parts.length - 1
    // this.name = parts[lastIndex];
    parts.splice(lastIndex, 1)
    return parts.join(':')
  }
}

export interface StockAnalysis {
  yield: string,
  gainLoss: string
}

export interface StockSymbol {
  name: string
  accounts: Account[]
  analysis?: StockAnalysis
}

/**
 * The object that the AA definition gets parsed into from TOML (or YAML).
 * Besides the properties below, it also contains the properties for children,
 * i.e. Equity.
 * {
 *   Allocation: {
 *     allocation: 100
 *     Equity: {
 *      allocation: 55
 *      symbols: ["VTI"]
 *     } } }
 */
export interface AssetClassDefinition {
  allocation: number
  symbols: string[]
}
