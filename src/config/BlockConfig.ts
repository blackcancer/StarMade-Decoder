/**
 * @fileoverview StarMade Block Configuration Parser
 *
 * Parses and writes BlockConfig XML files, preserving immutable block definitions and custom block overrides.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * Reads and writes StarMade BlockConfig.xml data.
 *
 * Merged load order:
 *   1. data/config/BlockConfig.xml             — vanilla block definitions (read-only)
 *   2. customBlockConfig/BlockConfigImport.xml — custom overrides/additions, when present
 *
 * Writes are intentionally limited to customBlockConfig/BlockConfigImport.xml.
 *
 * Port of ElementInformation.java + ElementParser.java + ElementKeyMap.java.
 *
 * XML structure:
 * <Config>
 *   <Element>
 *     <General>
 *       <Category>
 *         <SubCategory>
 *           <Block icon="N" name="..." textureId="..." type="TYPE_NAME">
 *             <Hitpoints>N</Hitpoints>
 *             <Mass>N.N</Mass>
 *             <Volume>N.N</Volume>
 *             <Price>N</Price>
 *             <Description>...</Description>
 *             <ArmorValue>N.N</ArmorValue>
 *             <Placable>true</Placable>
 *             <InShop>true</InShop>
 *             <Orientation>true</Orientation>
 *             <CanActivate>false</CanActivate>
 *             <Deprecated>false</Deprecated>
 *             <BlockStyle>N</BlockStyle>
 *             <SlabIds>N, N, N</SlabIds>
 *             <StyleIds>N, N, N</StyleIds>
 *             <BlockComputerReference>N</BlockComputerReference>
 *             ...
 *           </Block>
 *         </SubCategory>
 *       </Category>
 *     </General>
 *   </Element>
 * </Config>
 *
 * The numeric type ID comes from the <Block> node's "type" attribute.
 */

import fs from 'fs';
import path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { SMToolConfig } from './SMToolConfig.js';

// ── BlockDefinition — ElementInformation.java Port ───────────────────────────

/**
 * Raw recipe ingredient as it appears in BlockConfig consistence lists.
 */
export interface BlockIngredient {
  readonly type: string;
  readonly count: number;
}

/**
 * Collision-shape descriptor parsed from the block collision tags.
 */
export interface BlockCollisionShape {
  readonly type: string;
  readonly slab: number;
  readonly styleId: number;
}

/**
 * Extra armor modifiers used by StarMade effect-combination blocks.
 */
export interface BlockEffectArmor {
  readonly heat: number;
  readonly kinetic: number;
  readonly em: number;
}

/**
 * StarMade-Open BlockStyle metadata with render and orientation semantics.
 */
export interface BlockStyleDescriptor {
  readonly id: number;
  readonly key: string;
  readonly realName: string;
  readonly description: string;
  readonly cube: boolean;
  readonly solidBlockStyle: boolean;
  readonly blendedBlockStyle: boolean;
  readonly orientations: number;
}

/**
 * StarMade ResourceInjection metadata used by asteroid/flora overlay rendering.
 */
export interface ResourceInjectionDescriptor {
  readonly index: number;
  readonly key: string;
  readonly usesOverlay: boolean;
}

/**
 * Stable reference to another block, preserving unresolved IDs/type names.
 */
export interface BlockReference {
  readonly id: number | null;
  readonly typeName: string;
  readonly name: string;
  readonly block: BlockDefinition | null;
}

/**
 * Recipe ingredient reference enriched with a resolved block when available.
 */
export interface BlockIngredientReference extends BlockReference {
  readonly count: number;
}

/**
 * Human-facing identity fields for a block element.
 */
export interface BlockIdentityView {
  readonly id: number;
  readonly typeName: string;
  readonly name: string;
  readonly fullName: string;
  readonly inventoryGroup: string;
  readonly description: string;
}

/**
 * Rendering metadata derived from ElementInformation-style BlockConfig fields.
 */
export interface BlockRenderView {
  readonly style: BlockStyleDescriptor;
  readonly defaultOrientation: number;
  readonly textureIds: readonly number[];
  readonly transparent: boolean;
  readonly animated: boolean;
  readonly individualSides: number;
  readonly sideTexturesPointToOrientation: boolean;
  readonly hasActivationTexture: boolean;
  readonly extendedTexture: boolean;
  readonly drawOnlyInBuildMode: boolean;
  readonly resourceInjection: ResourceInjectionDescriptor;
  readonly lightSource: boolean;
  readonly lightSourceColor: readonly [number, number, number, number];
  readonly hasLod: boolean;
  readonly lodShape: string;
  readonly lodShapeActive: string;
  readonly lodShapeStyle: number;
  readonly lodActivationAnimationStyle: number;
  readonly isNormalBlockStyle: boolean;
  readonly isSolidBlockStyle: boolean;
  readonly isBlendBlockStyle: boolean;
  readonly isSprite: boolean;
  readonly isNormal24: boolean;
}

/**
 * Logic-network metadata and controller relationships for a block.
 */
export interface BlockLogicView {
  readonly canActivate: boolean;
  readonly drawLogicConnection: boolean;
  readonly signal: boolean;
  readonly signaledByRail: boolean;
  readonly button: boolean;
  readonly controlsAll: boolean;
  readonly controlledBy: readonly BlockReference[];
  readonly controlling: readonly BlockReference[];
  readonly canBeControlledByAny: boolean;
  readonly canControlAny: boolean;
}

/**
 * Recipe, source-reference, and resource metadata for a block.
 */
export interface BlockRecipeView {
  readonly inRecipe: boolean;
  readonly sourceReference: BlockReference | null;
  readonly blockResourceType: number;
  readonly consistence: readonly BlockIngredientReference[];
  readonly cubatomConsistence: readonly BlockIngredientReference[];
  readonly recipeBuyResources: readonly BlockReference[];
}

/**
 * Factory production metadata for blocks that participate in crafting chains.
 */
export interface BlockFactoryView {
  readonly basicResourceFactory: number;
  readonly producedInFactory: number;
  readonly factoryBakeTime: number;
}

/**
 * Physics and detailed astronaut collision metadata for a block.
 */
export interface BlockCollisionView {
  readonly physical: boolean;
  readonly cubeCubeCollision: boolean;
  readonly lodCollisionPhysical: boolean;
  readonly useDetailedCollisionForAstronautMode: boolean;
  readonly defaultShape: BlockCollisionShape | null;
  readonly detailedAstronautShape: BlockCollisionShape | null;
}

/**
 * Reactor chamber tree, capacity, permission, and upgrade metadata.
 */
export interface BlockChamberView {
  readonly any: boolean;
  readonly general: boolean;
  readonly specific: boolean;
  readonly upgraded: boolean;
  readonly root: BlockReference | null;
  readonly parent: BlockReference | null;
  readonly upgradedRoot: BlockReference | null;
  readonly upgradesTo: BlockReference | null;
  readonly children: readonly BlockReference[];
  readonly prerequisites: readonly BlockReference[];
  readonly mutuallyExclusive: readonly BlockReference[];
  readonly appliesTo: BlockReference | null;
  readonly capacity: number;
  readonly capacityBranch: number;
  readonly capacityWithUpgrades: number;
  readonly permission: number;
  readonly permittedEntityTypes: readonly string[];
  readonly configGroups: readonly string[];
  readonly reactorHp: number;
  readonly reactorGeneralIconIndex: number;
}

/**
 * Convenience classification flags used by tools and render pipelines.
 */
export interface BlockClassificationView {
  readonly armor: boolean;
  readonly placable: boolean;
  readonly shoppable: boolean;
  readonly deprecated: boolean;
  readonly door: boolean;
  readonly beacon: boolean;
  readonly enterable: boolean;
  readonly sensorInput: boolean;
  readonly systemBlock: boolean;
  readonly reactorChamber: boolean;
  readonly needsComputer: boolean;
  readonly computer: BlockReference | null;
  readonly wildcardIds: readonly number[];
}

/**
 * ElementInformation-inspired view that groups raw block data by tooling domain.
 *
 * This is the preferred high-level API for renderers and editors. It keeps the
 * original BlockDefinition available while exposing resolved render, logic,
 * recipe, collision, chamber, and classification views.
 */
export interface BlockElementInfo {
  readonly block: BlockDefinition;
  readonly identity: BlockIdentityView;
  readonly render: BlockRenderView;
  readonly logic: BlockLogicView;
  readonly recipe: BlockRecipeView;
  readonly factory: BlockFactoryView;
  readonly collision: BlockCollisionView;
  readonly chamber: BlockChamberView;
  readonly classification: BlockClassificationView;
}

/**
 * Defines ELEMENT_SIDE_FRONT for StarMade configuration loading, editing, and metadata enrichment.
 */
const ELEMENT_SIDE_FRONT = 0;
/**
 * Defines ELEMENT_SIDE_TOP for StarMade configuration loading, editing, and metadata enrichment.
 */
const ELEMENT_SIDE_TOP = 2;
/**
 * Defines ELEMENT_SIDE_BOTTOM for StarMade configuration loading, editing, and metadata enrichment.
 */
const ELEMENT_SIDE_BOTTOM = 3;
/**
 * Defines CARGO_SPACE_ID for StarMade configuration loading, editing, and metadata enrichment.
 */
const CARGO_SPACE_ID = 689;
/**
 * Defines TRANSPORTER_MODULE_ID for StarMade configuration loading, editing, and metadata enrichment.
 */
const TRANSPORTER_MODULE_ID = 688;
/**
 * Defines GRAVITY_UNIT_ID for StarMade configuration loading, editing, and metadata enrichment.
 */
const GRAVITY_UNIT_ID = 56;

/**
 * BlockStyle table ported from StarMade-Open ElementInformation style handling.
 */
const BLOCK_STYLE_DESCRIPTORS: readonly BlockStyleDescriptor[] = Object.freeze([
  Object.freeze({
    id: 0,
    key: 'NORMAL',
    realName: 'normal',
    description: 'A normal 6 sided block',
    cube: true,
    solidBlockStyle: false,
    blendedBlockStyle: false,
    orientations: 6,
  }),
  Object.freeze({
    id: 1,
    key: 'WEDGE',
    realName: 'wedge',
    description: 'A wedged block',
    cube: false,
    solidBlockStyle: true,
    blendedBlockStyle: false,
    orientations: 12,
  }),
  Object.freeze({
    id: 2,
    key: 'CORNER',
    realName: 'corner',
    description: 'A corner block with a square base',
    cube: false,
    solidBlockStyle: true,
    blendedBlockStyle: false,
    orientations: 24,
  }),
  Object.freeze({
    id: 3,
    key: 'SPRITE',
    realName: 'sprite',
    description: 'An X-shaped spritelike block',
    cube: false,
    solidBlockStyle: false,
    blendedBlockStyle: true,
    orientations: 6,
  }),
  Object.freeze({
    id: 4,
    key: 'TETRA',
    realName: 'tetra',
    description: 'A corner angled block with a triangle base',
    cube: false,
    solidBlockStyle: true,
    blendedBlockStyle: false,
    orientations: 8,
  }),
  Object.freeze({
    id: 5,
    key: 'HEPTA',
    realName: 'penta',
    description: 'A block with a tetra cut off',
    cube: false,
    solidBlockStyle: true,
    blendedBlockStyle: false,
    orientations: 8,
  }),
  Object.freeze({
    id: 6,
    key: 'NORMAL24',
    realName: 'normal24',
    description: 'A block with 24 orientation like rails',
    cube: true,
    solidBlockStyle: false,
    blendedBlockStyle: false,
    orientations: 24,
  }),
]);

/**
 * Defines UNKNOWN_BLOCK_STYLE for StarMade configuration loading, editing, and metadata enrichment.
 */
const UNKNOWN_BLOCK_STYLE: BlockStyleDescriptor = Object.freeze({
  id: -1,
  key: 'UNKNOWN',
  realName: 'unknown',
  description: 'Unknown block style',
  cube: false,
  solidBlockStyle: false,
  blendedBlockStyle: false,
  orientations: 0,
});

/**
 * ResourceInjection lookup by StarMade enum index.
 */
const RESOURCE_INJECTION_BY_INDEX = new Map<number, ResourceInjectionDescriptor>([
  [0, Object.freeze({ index: 0, key: 'OFF', usesOverlay: false })],
  [1, Object.freeze({ index: 1, key: 'ORE', usesOverlay: true })],
  [17, Object.freeze({ index: 17, key: 'FLORA', usesOverlay: true })],
]);

/**
 * Normalizes BlockTypes keys for stable lookup.
 *
 * @param typeName - Raw XML type name or BlockTypes property key.
 * @returns Uppercase key used by StarMade-Decoder maps.
 */
function normalizeTypeName(typeName: string): string {
  return typeName.trim().toUpperCase();
}

/**
 * Resolves a StarMade BlockStyle ID into render-shape metadata.
 *
 * @param blockStyle - Numeric BlockStyle value from BlockConfig.
 * @returns The known descriptor, or an UNKNOWN descriptor preserving the ID.
 */
export function getBlockStyleDescriptor(blockStyle: number): BlockStyleDescriptor {
  return BLOCK_STYLE_DESCRIPTORS.find((style) => style.id === blockStyle)
    ?? Object.freeze({ ...UNKNOWN_BLOCK_STYLE, id: blockStyle });
}

/**
 * Resolves a StarMade ResourceInjection index into overlay/render metadata.
 *
 * @param index - Numeric ResourceInjection value from BlockConfig.
 * @returns The known descriptor, or an UNKNOWN descriptor preserving the index.
 */
export function getResourceInjectionDescriptor(index: number): ResourceInjectionDescriptor {
  return RESOURCE_INJECTION_BY_INDEX.get(index)
    ?? Object.freeze({ index, key: `UNKNOWN_${index}`, usesOverlay: index !== 0 });
}

/**
 * Parsed BlockConfig fields that are less common than the constructor core.
 *
 * The split keeps BlockDefinition constructor compatibility while still making
 * StarMade-Open metadata available for higher-level ElementInfo views.
 */
export interface BlockDefinitionMetadata {
  readonly fullName: string;
  readonly oldHitpoints: number;
  readonly lowHpSetting: number;
  readonly structureHpContribution: number;
  readonly explosionAbsorption: number;
  readonly blockResourceType: number;
  readonly basicResourceFactory: number;
  readonly producedInFactory: number;
  readonly factoryBakeTime: number;
  readonly inRecipe: boolean;
  readonly physical: boolean;
  readonly cubeCubeCollision: boolean;
  readonly useDetailedCollisionForAstronautMode: boolean;
  readonly collisionDefault: BlockCollisionShape | null;
  readonly detailedCollisionForAstronautMode: BlockCollisionShape | null;
  readonly door: boolean;
  readonly beacon: boolean;
  readonly enterable: boolean;
  readonly sensorInput: boolean;
  readonly systemBlock: boolean;
  readonly sourceReference: number;
  readonly inventoryGroup: string;
  readonly controlledBy: readonly string[];
  readonly controlling: readonly string[];
  readonly consistence: readonly BlockIngredient[];
  readonly cubatomConsistence: readonly BlockIngredient[];
  readonly recipeBuyResources: readonly string[];
  readonly wildcardIds: readonly number[];
  readonly mainCombinationController: boolean;
  readonly supportCombinationController: boolean;
  readonly effectCombinationController: boolean;
  readonly effectArmor: BlockEffectArmor;
  readonly generalChamber: boolean;
  readonly chamberParent: number;
  readonly chamberChildren: readonly number[];
  readonly chamberPrerequisites: readonly number[];
  readonly chamberMutuallyExclusive: readonly number[];
  readonly chamberUpgradesTo: number;
  readonly chamberAppliesTo: number;
  readonly chamberCapacity: number;
  readonly chamberPermission: number;
  readonly chamberConfigGroups: readonly string[];
  readonly reactorHp: number;
  readonly reactorGeneralIconIndex: number;
  readonly lodActivationAnimationStyle: number;
}

/**
 * Default metadata used when a BlockConfig tag is absent.
 */
const DEFAULT_BLOCK_METADATA: BlockDefinitionMetadata = Object.freeze({
  fullName: '',
  oldHitpoints: 0,
  lowHpSetting: 0,
  structureHpContribution: 0,
  explosionAbsorption: 0,
  blockResourceType: 0,
  basicResourceFactory: 0,
  producedInFactory: 0,
  factoryBakeTime: 0,
  inRecipe: false,
  physical: false,
  cubeCubeCollision: false,
  useDetailedCollisionForAstronautMode: false,
  collisionDefault: null,
  detailedCollisionForAstronautMode: null,
  door: false,
  beacon: false,
  enterable: false,
  sensorInput: false,
  systemBlock: false,
  sourceReference: 0,
  inventoryGroup: '',
  controlledBy: Object.freeze([]),
  controlling: Object.freeze([]),
  consistence: Object.freeze([]),
  cubatomConsistence: Object.freeze([]),
  recipeBuyResources: Object.freeze([]),
  wildcardIds: Object.freeze([]),
  mainCombinationController: false,
  supportCombinationController: false,
  effectCombinationController: false,
  effectArmor: Object.freeze({ heat: 0, kinetic: 0, em: 0 }),
  generalChamber: false,
  chamberParent: 0,
  chamberChildren: Object.freeze([]),
  chamberPrerequisites: Object.freeze([]),
  chamberMutuallyExclusive: Object.freeze([]),
  chamberUpgradesTo: 0,
  chamberAppliesTo: 0,
  chamberCapacity: 0,
  chamberPermission: 0,
  chamberConfigGroups: Object.freeze([]),
  reactorHp: 0,
  reactorGeneralIconIndex: 0,
  lodActivationAnimationStyle: 0,
});

/**
 * Immutable parsed BlockConfig block definition.
 *
 * It stores the raw XML-facing fields and exposes StarMade-Open-inspired
 * computed properties without requiring renderers to parse XML tags directly.
 */
export class BlockDefinition {
  /**
   * Creates a BlockDefinition instance.
   *
   * @param id - Input value for the constructor operation.
   * @param name - Input value for the constructor operation.
   * @param icon - Input value for the constructor operation.
   * @param hp - Input value for the constructor operation.
   * @param mass - Input value for the constructor operation.
   * @param volume - Input value for the constructor operation.
   * @param price - Input value for the constructor operation.
   * @param description - Input value for the constructor operation.
   * @param armor - Input value for the constructor operation.
   * @param isPlacable - Input value for the constructor operation.
   * @param inShop - Input value for the constructor operation.
   * @param hasOrientation - Input value for the constructor operation.
   * @param canActivate - Input value for the constructor operation.
   * @param isDeprecated - Input value for the constructor operation.
   * @param blockStyle - Input value for the constructor operation.
   * @param slabIds - Input value for the constructor operation.
   * @param styleIds - Input value for the constructor operation.
   * @param computerReference - Input value for the constructor operation.
   * @param xmlTypeName - Input value for the constructor operation.
   * @param textureIds - Input value for the constructor operation.
   * @param transparent - Input value for the constructor operation.
   * @param animated - Input value for the constructor operation.
   * @param individualSides - Input value for the constructor operation.
   * @param sideTexturesPointToOrientation - Input value for the constructor operation.
   * @param hasActivationTexture - Input value for the constructor operation.
   * @param lightSource - Input value for the constructor operation.
   * @param lightSourceColor - Input value for the constructor operation.
   * @param lodShape - Input value for the constructor operation.
   * @param lodShapeActive - Input value for the constructor operation.
   * @param lodShapeStyle - Input value for the constructor operation.
   * @param drawOnlyInBuildMode - Input value for the constructor operation.
   * @param extendedTexture - Input value for the constructor operation.
   * @param resourceInjection - Input value for the constructor operation.
   * @param chamberRoot - Input value for the constructor operation.
   * @param reactorChamberSpecific - Input value for the constructor operation.
   * @param lodCollisionPhysical - Input value for the constructor operation.
   * @param slab - Input value for the constructor operation.
   * @param drawLogicConnection - Input value for the constructor operation.
   * @param logicBlock - Input value for the constructor operation.
   * @param logicSignaledByRail - Input value for the constructor operation.
   * @param logicBlockButton - Input value for the constructor operation.
   * @param metadata - Input value for the constructor operation.
   */
  constructor(
    /** Numeric block ID from the XML "type" attribute. */
    readonly id: number,
    /** Display name from the XML "name" attribute. */
    readonly name: string,
    /** Texture icon index from the XML "icon" attribute. */
    readonly icon: number,
    /** Block hit points. */
    readonly hp: number,
    /** Block mass in tonnes. */
    readonly mass: number,
    /** Block volume in cubic meters. */
    readonly volume: number,
    /** Block price in credits. */
    readonly price: number,
    /** User-facing description. */
    readonly description: string,
    /** Armor value (0.0 means no armor). */
    readonly armor: number,
    /** Whether the block can be placed by a player. */
    readonly isPlacable: boolean,
    /** Whether the block is available in shops. */
    readonly inShop: boolean,
    /** Whether the block supports orientation/rotation. */
    readonly hasOrientation: boolean,
    /** Whether the block can be toggled on/off. */
    readonly canActivate: boolean,
    /** Whether the block is deprecated and should not be used. */
    readonly isDeprecated: boolean,
    /** Block style (0=normal, 1=slab, etc.). */
    readonly blockStyle: number,
    /** IDs of slab variants. */
    readonly slabIds: readonly number[],
    /** IDs of style variants. */
    readonly styleIds: readonly number[],
    /** Reference computer block ID (0 means none). */
    readonly computerReference: number,
    /** XML category/type name (for example "Grey Basic Armor"). */
    readonly xmlTypeName: string,
    /** Texture ids in StarMade face order: FRONT, BACK, TOP, BOTTOM, RIGHT, LEFT. */
    readonly textureIds: readonly number[] = [],
    /** Whether the block uses alpha/transparency handling. */
    readonly transparent: boolean = false,
    /** Whether texture animation frames are enabled for this block. */
    readonly animated: boolean = false,
    /** StarMade IndividualSides value controlling texture expansion. */
    readonly individualSides: number = 1,
    /** Whether face textures rotate with block orientation. */
    readonly sideTexturesPointToOrientation: boolean = false,
    /** Whether inactive blocks use textureId + 1. */
    readonly hasActivationTexture: boolean = false,
    /** Whether the block is a light source. */
    readonly lightSource: boolean = false,
    /** RGBA light source color from BlockConfig. */
    readonly lightSourceColor: readonly [number, number, number, number] = [1, 1, 1, 1],
    /** Optional LOD mesh name for inactive/default state. */
    readonly lodShape: string = '',
    /** Optional LOD mesh name for active state. */
    readonly lodShapeActive: string = '',
    /** StarMade LodShapeFromFar mode: 0=solid block, 1=sprite, 2=invisible. */
    readonly lodShapeStyle: number = 0,
    /** Whether this block is only drawn in build mode. */
    readonly drawOnlyInBuildMode: boolean = false,
    /** Whether this block uses the StarMade 4x4 extended texture order. */
    readonly extendedTexture: boolean = false,
    /** StarMade ResourceInjection enum index (0=off, 1=ore, 17=flora). */
    readonly resourceInjection: number = 0,
    /** Reactor chamber root ID from BlockConfig, 0 when not chamber-specific. */
    readonly chamberRoot: number = 0,
    /** Whether this block is tied to a reactor chamber root. */
    readonly reactorChamberSpecific: boolean = false,
    /** Whether the LOD model should keep physical collision behavior. */
    readonly lodCollisionPhysical: boolean = true,
    /** StarMade slab factor from the Slab tag. */
    readonly slab: number = 0,
    /** Whether this block should draw logic connection overlays. */
    readonly drawLogicConnection: boolean = false,
    /** Whether this block participates in logic networks. */
    readonly logicBlock: boolean = false,
    /** Whether rails may signal this logic block. */
    readonly logicSignaledByRail: boolean = false,
    /** Whether this logic block acts as a button. */
    readonly logicBlockButton: boolean = false,
    /** Additional parsed BlockConfig tags that do not yet deserve top-level fields. */
    readonly metadata: BlockDefinitionMetadata = DEFAULT_BLOCK_METADATA,
  ) {}

  /** StarMade-Open BlockStyle descriptor for this block style ID. */
  get style(): BlockStyleDescriptor {
    return getBlockStyleDescriptor(this.blockStyle);
  }

  /** StarMade-Open ResourceInjection descriptor for this block. */
  get resourceInjectionInfo(): ResourceInjectionDescriptor {
    return getResourceInjectionDescriptor(this.resourceInjection);
  }

  /** True when this block has any LOD mesh path. Mirrors ElementInformation.hasLod(). */
  get hasLod(): boolean {
    return this.lodShape.length > 0;
  }

  /** True for cube-style block styles. Mirrors ElementInformation.isNormalBlockStyle(). */
  get isNormalBlockStyle(): boolean {
    return this.style.cube;
  }

  /** True for StarMade solid non-cube shape styles. */
  get isSolidBlockStyle(): boolean {
    return this.style.solidBlockStyle;
  }

  /** True for sprite/blended styles, including LOD style 1. */
  get isBlendBlockStyle(): boolean {
    return this.style.blendedBlockStyle || (this.hasLod && this.lodShapeStyle === 1);
  }

  /** True when the block has positive armor value. Mirrors ElementInformation.isArmor(). */
  get isArmor(): boolean {
    return this.armor > 0;
  }

  /** Default orientation as implemented by ElementInformation.getDefaultOrientation(). */
  get defaultOrientation(): number {
    if (this.id === CARGO_SPACE_ID) return 4;
    if (this.id === TRANSPORTER_MODULE_ID) return ELEMENT_SIDE_TOP;
    if (this.blockStyle === 3 || this.individualSides === 3) return ELEMENT_SIDE_TOP;
    if (this.blockStyle === 6) return 14;
    return this.id === GRAVITY_UNIT_ID ? ELEMENT_SIDE_BOTTOM : ELEMENT_SIDE_FRONT;
  }

  /** True for general or specific reactor chamber blocks. */
  get isReactorChamberAny(): boolean {
    return this.metadata.generalChamber || this.reactorChamberSpecific;
  }

  /** True for general reactor chamber blocks. */
  get isReactorChamberGeneral(): boolean {
    return this.metadata.generalChamber;
  }

  /** True for specific reactor chamber blocks. */
  get isReactorChamberSpecific(): boolean {
    return this.reactorChamberSpecific;
  }

  /** Source reference rule from ElementInformation.getSourceReference(). */
  get sourceReferenceId(): number {
    return this.chamberRoot !== 0 ? this.chamberRoot : this.metadata.sourceReference;
  }

  /** Render-oriented element information for this block, without cross-block references. */
  get render(): BlockRenderView {
    return createBlockRenderView(this);
  }

  /** Collision-oriented element information for this block. */
  get collision(): BlockCollisionView {
    return createBlockCollisionView(this);
  }

  /** Factory-oriented element information for this block. */
  get factory(): BlockFactoryView {
    return createBlockFactoryView(this);
  }

  /** StarMade-Open-inspired element information with optional BlockConfig-backed references. */
  toElementInfo(config?: BlockConfig): BlockElementInfo {
    return createBlockElementInfo(this, config);
  }

  /** Returns an immutable variant with one or more modified properties. */
  with(overrides: Partial<{
    name: string; hp: number; mass: number; volume: number;
    price: number; description: string; armor: number;
    isPlacable: boolean; inShop: boolean; hasOrientation: boolean;
    canActivate: boolean; isDeprecated: boolean; blockStyle: number;
    textureIds: readonly number[]; transparent: boolean; animated: boolean;
    individualSides: number; sideTexturesPointToOrientation: boolean;
    hasActivationTexture: boolean; lightSource: boolean;
    lightSourceColor: readonly [number, number, number, number];
    lodShape: string; lodShapeActive: string; lodShapeStyle: number;
    drawOnlyInBuildMode: boolean; extendedTexture: boolean;
    resourceInjection: number; chamberRoot: number;
    reactorChamberSpecific: boolean; lodCollisionPhysical: boolean;
    slab: number; drawLogicConnection: boolean; logicBlock: boolean;
    logicSignaledByRail: boolean; logicBlockButton: boolean;
    metadata: BlockDefinitionMetadata;
  }>): BlockDefinition {
    const chamberRoot = overrides.chamberRoot ?? this.chamberRoot;

    return new BlockDefinition(
      this.id,
      overrides.name         ?? this.name,
      this.icon,
      overrides.hp           ?? this.hp,
      overrides.mass         ?? this.mass,
      overrides.volume       ?? this.volume,
      overrides.price        ?? this.price,
      overrides.description  ?? this.description,
      overrides.armor        ?? this.armor,
      overrides.isPlacable   ?? this.isPlacable,
      overrides.inShop       ?? this.inShop,
      overrides.hasOrientation ?? this.hasOrientation,
      overrides.canActivate  ?? this.canActivate,
      overrides.isDeprecated ?? this.isDeprecated,
      overrides.blockStyle   ?? this.blockStyle,
      this.slabIds,
      this.styleIds,
      this.computerReference,
      this.xmlTypeName,
      overrides.textureIds ?? this.textureIds,
      overrides.transparent ?? this.transparent,
      overrides.animated ?? this.animated,
      overrides.individualSides ?? this.individualSides,
      overrides.sideTexturesPointToOrientation ?? this.sideTexturesPointToOrientation,
      overrides.hasActivationTexture ?? this.hasActivationTexture,
      overrides.lightSource ?? this.lightSource,
      overrides.lightSourceColor ?? this.lightSourceColor,
      overrides.lodShape ?? this.lodShape,
      overrides.lodShapeActive ?? this.lodShapeActive,
      overrides.lodShapeStyle ?? this.lodShapeStyle,
      overrides.drawOnlyInBuildMode ?? this.drawOnlyInBuildMode,
      overrides.extendedTexture ?? this.extendedTexture,
      overrides.resourceInjection ?? this.resourceInjection,
      chamberRoot,
      overrides.reactorChamberSpecific ?? (chamberRoot !== 0),
      overrides.lodCollisionPhysical ?? this.lodCollisionPhysical,
      overrides.slab ?? this.slab,
      overrides.drawLogicConnection ?? this.drawLogicConnection,
      overrides.logicBlock ?? this.logicBlock,
      overrides.logicSignaledByRail ?? this.logicSignaledByRail,
      overrides.logicBlockButton ?? this.logicBlockButton,
      overrides.metadata ?? this.metadata,
    );
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string {
    return `BlockDefinition(id=${this.id}, name="${this.name}", hp=${this.hp}, mass=${this.mass})`;
  }
}

// ── XML Parser ───────────────────────────────────────────────────────────────

/**
 * Defines XML_PARSER for StarMade configuration loading, editing, and metadata enrichment.
 */
const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
  isArray: (name) => ['Block'].includes(name),
});

/**
 * Defines XML_BUILDER for StarMade configuration loading, editing, and metadata enrichment.
 */
const XML_BUILDER = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  indentBy: '  ',
});

/**
 * Normalizes ElementValues for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the normalizeElementValues operation.
 * @returns The computed StarMade-Decoder value.
 */
function normalizeElementValues(value: unknown): readonly string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((item) => normalizeElementValues(item));
  return [String(value)].filter((item) => item.length > 0);
}

/**
 * Parses ElementList for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the parseElementList operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseElementList(value: unknown): readonly string[] {
  if (value === undefined || value === null || typeof value !== 'object') return [];
  return normalizeElementValues((value as { Element?: unknown }).Element);
}

/**
 * Parses IngredientList for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the parseIngredientList operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseIngredientList(value: unknown): readonly BlockIngredient[] {
  if (value === undefined || value === null || typeof value !== 'object') return [];
  const rawItems = (value as { Item?: unknown }).Item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems === undefined ? [] : [rawItems];

  return items.flatMap((item): BlockIngredient[] => {
    if (item === undefined || item === null) return [];
    if (typeof item === 'object') {
      const raw = item as { '#text'?: unknown; '@_count'?: unknown };
      const type = String(raw['#text'] ?? '').trim();
      const count = parseInt(String(raw['@_count'] ?? 1), 10);

      return type ? [{ type, count: Number.isFinite(count) ? count : 1 }] : [];
    }

    const type = String(item).trim();
    return type ? [{ type, count: 1 }] : [];
  });
}

/**
 * Parses BraceIntArray for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the parseBraceIntArray operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseBraceIntArray(value: unknown): readonly number[] {
  if (value === undefined || value === null) return [];
  const text = String(value).replace(/[{}]/g, '').trim();
  if (!text) return [];

  return text.split(',').map((part) => parseInt(part.trim(), 10)).filter((part) => Number.isFinite(part));
}

/**
 * Parses CollisionShape for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the parseCollisionShape operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseCollisionShape(value: unknown): BlockCollisionShape | null {
  if (value === undefined || value === null || typeof value !== 'object') return null;
  const raw = value as { StyleId?: unknown; '@_slab'?: unknown; '@_type'?: unknown };
  const slab = parseInt(String(raw['@_slab'] ?? 0), 10);
  const styleId = parseInt(String(raw.StyleId ?? 0), 10);

  return {
    type: String(raw['@_type'] ?? ''),
    slab: Number.isFinite(slab) ? slab : 0,
    styleId: Number.isFinite(styleId) ? styleId : 0,
  };
}

/**
 * Parses EffectArmor for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the parseEffectArmor operation.
 * @returns The computed StarMade-Decoder value.
 */
function parseEffectArmor(value: unknown): BlockEffectArmor {
  if (value === undefined || value === null || typeof value !== 'object') {
    return { heat: 0, kinetic: 0, em: 0 };
  }

  const raw = value as { Heat?: unknown; Kinetic?: unknown; EM?: unknown };
  const heat = parseFloat(String(raw.Heat ?? 0));
  const kinetic = parseFloat(String(raw.Kinetic ?? 0));
  const em = parseFloat(String(raw.EM ?? 0));

  return {
    heat: Number.isFinite(heat) ? heat : 0,
    kinetic: Number.isFinite(kinetic) ? kinetic : 0,
    em: Number.isFinite(em) ? em : 0,
  };
}

/**
 * Handles the elementsToXml operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param elements - Input value for the elementsToXml operation.
 * @returns The computed StarMade-Decoder value.
 */
function elementsToXml(elements: readonly string[]): { Element: string | string[] } | undefined {
  if (elements.length === 0) return undefined;
  return { Element: elements.length === 1 ? elements[0] : [...elements] };
}

/**
 * Handles the ingredientsToXml operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param ingredients - Input value for the ingredientsToXml operation.
 * @returns The computed StarMade-Decoder value.
 */
function ingredientsToXml(ingredients: readonly BlockIngredient[]): { Item: unknown } | undefined {
  if (ingredients.length === 0) return undefined;
  const items = ingredients.map((item) => ({ '#text': item.type, '@_count': String(item.count) }));
  return { Item: items.length === 1 ? items[0] : items };
}

/**
 * Handles the braceIntArrayToXml operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param values - Input value for the braceIntArrayToXml operation.
 * @returns The computed StarMade-Decoder value.
 */
function braceIntArrayToXml(values: readonly number[]): string {
  return values.length > 0 ? `{${values.join(', ')}}` : '{}';
}

/**
 * Handles the collisionShapeToXml operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the collisionShapeToXml operation.
 * @returns The computed StarMade-Decoder value.
 */
function collisionShapeToXml(value: BlockCollisionShape | null): unknown {
  if (!value) return undefined;
  return {
    '@_type': value.type,
    '@_slab': String(value.slab),
    StyleId: value.styleId,
  };
}

/**
 * Handles the effectArmorToXml operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param value - Input value for the effectArmorToXml operation.
 * @returns The computed StarMade-Decoder value.
 */
function effectArmorToXml(value: BlockEffectArmor): unknown {
  return {
    Heat: value.heat,
    Kinetic: value.kinetic,
    EM: value.em,
  };
}

/**
 * Builds BlockReference for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param config - Input value for the createBlockReference operation.
 * @param value - Input value for the createBlockReference operation.
 * @returns The computed StarMade-Decoder value.
 */
function createBlockReference(config: BlockConfig | undefined, value: number | string): BlockReference {
  if (typeof value === 'number') {
    const block = Number.isFinite(value) ? config?.getById(value) : undefined;
    return {
      id: Number.isFinite(value) ? value : null,
      typeName: block?.xmlTypeName ?? String(value),
      name: block?.name ?? (Number.isFinite(value) ? `block#${value}` : String(value)),
      block: block ?? null,
    };
  }

  const normalized = normalizeTypeName(value);
  const block = normalized ? config?.getByTypeName(normalized) : undefined;
  const parsedId = parseInt(normalized, 10);
  if (!block && Number.isFinite(parsedId)) {
    return createBlockReference(config, parsedId);
  }

  return {
    id: block?.id ?? null,
    typeName: normalized,
    name: block?.name ?? normalized,
    block: block ?? null,
  };
}

/**
 * Builds OptionalBlockReference for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param config - Input value for the createOptionalBlockReference operation.
 * @param id - Input value for the createOptionalBlockReference operation.
 * @returns The computed StarMade-Decoder value.
 */
function createOptionalBlockReference(config: BlockConfig | undefined, id: number): BlockReference | null {
  return id !== 0 ? createBlockReference(config, id) : null;
}

/**
 * Builds BlockIngredientReference for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param config - Input value for the createBlockIngredientReference operation.
 * @param ingredient - Input value for the createBlockIngredientReference operation.
 * @returns The computed StarMade-Decoder value.
 */
function createBlockIngredientReference(config: BlockConfig | undefined, ingredient: BlockIngredient): BlockIngredientReference {
  return {
    ...createBlockReference(config, ingredient.type),
    count: ingredient.count,
  };
}

/**
 * Builds the render-oriented ElementInfo section for one block.
 *
 * @param block - Parsed block definition.
 * @returns Render metadata needed by StarMade-compatible render pipelines.
 */
function createBlockRenderView(block: BlockDefinition): BlockRenderView {
  const style = block.style;
  return {
    style,
    defaultOrientation: block.defaultOrientation,
    textureIds: block.textureIds,
    transparent: block.transparent,
    animated: block.animated,
    individualSides: block.individualSides,
    sideTexturesPointToOrientation: block.sideTexturesPointToOrientation,
    hasActivationTexture: block.hasActivationTexture,
    extendedTexture: block.extendedTexture,
    drawOnlyInBuildMode: block.drawOnlyInBuildMode,
    resourceInjection: block.resourceInjectionInfo,
    lightSource: block.lightSource,
    lightSourceColor: block.lightSourceColor,
    hasLod: block.hasLod,
    lodShape: block.lodShape,
    lodShapeActive: block.lodShapeActive,
    lodShapeStyle: block.lodShapeStyle,
    lodActivationAnimationStyle: block.metadata.lodActivationAnimationStyle,
    isNormalBlockStyle: style.cube,
    isSolidBlockStyle: style.solidBlockStyle,
    isBlendBlockStyle: block.isBlendBlockStyle,
    isSprite: style.id === 3,
    isNormal24: style.id === 6,
  };
}

/**
 * Builds the logic-network ElementInfo section for one block.
 *
 * @param block - Parsed block definition.
 * @param config - Optional config used to resolve controller references.
 * @returns Logic metadata and resolved controller relationships.
 */
function createBlockLogicView(block: BlockDefinition, config?: BlockConfig): BlockLogicView {
  const controlledBy = block.metadata.controlledBy.map((typeName) => createBlockReference(config, typeName));
  const controlling = block.metadata.controlling.map((typeName) => createBlockReference(config, typeName));
  return {
    canActivate: block.canActivate,
    drawLogicConnection: block.drawLogicConnection,
    signal: block.logicBlock,
    signaledByRail: block.logicSignaledByRail,
    button: block.logicBlockButton,
    controlsAll: block.logicBlock,
    controlledBy,
    controlling,
    canBeControlledByAny: controlledBy.length > 0,
    canControlAny: controlling.length > 0 || block.logicBlock,
  };
}

/**
 * Builds the recipe/resource ElementInfo section for one block.
 *
 * @param block - Parsed block definition.
 * @param config - Optional config used to resolve referenced ingredients.
 * @returns Recipe, source-reference, and resource metadata.
 */
function createBlockRecipeView(block: BlockDefinition, config?: BlockConfig): BlockRecipeView {
  return {
    inRecipe: block.metadata.inRecipe,
    sourceReference: createOptionalBlockReference(config, block.sourceReferenceId),
    blockResourceType: block.metadata.blockResourceType,
    consistence: block.metadata.consistence.map((item) => createBlockIngredientReference(config, item)),
    cubatomConsistence: block.metadata.cubatomConsistence.map((item) => createBlockIngredientReference(config, item)),
    recipeBuyResources: block.metadata.recipeBuyResources.map((typeName) => createBlockReference(config, typeName)),
  };
}

/**
 * Builds BlockFactoryView for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param block - Input value for the createBlockFactoryView operation.
 * @returns The computed StarMade-Decoder value.
 */
function createBlockFactoryView(block: BlockDefinition): BlockFactoryView {
  return {
    basicResourceFactory: block.metadata.basicResourceFactory,
    producedInFactory: block.metadata.producedInFactory,
    factoryBakeTime: block.metadata.factoryBakeTime,
  };
}

/**
 * Builds BlockCollisionView for StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param block - Input value for the createBlockCollisionView operation.
 * @returns The computed StarMade-Decoder value.
 */
function createBlockCollisionView(block: BlockDefinition): BlockCollisionView {
  return {
    physical: block.metadata.physical,
    cubeCubeCollision: block.metadata.cubeCubeCollision,
    lodCollisionPhysical: block.lodCollisionPhysical,
    useDetailedCollisionForAstronautMode: block.metadata.useDetailedCollisionForAstronautMode,
    defaultShape: block.metadata.collisionDefault,
    detailedAstronautShape: block.metadata.detailedCollisionForAstronautMode,
  };
}

/**
 * Handles the permittedEntityTypes operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param permission - Input value for the permittedEntityTypes operation.
 * @returns The computed StarMade-Decoder value.
 */
function permittedEntityTypes(permission: number): readonly string[] {
  if (permission === 0) return ['any'];
  const out: string[] = [];
  if ((permission & 1) === 1) out.push('ship');
  if ((permission & 2) === 2) out.push('station');
  if ((permission & 4) === 4) out.push('planet');
  return out;
}

/**
 * Reports whether isChamberUpgraded is true for the current value.
 *
 * @param block - Input value for the isChamberUpgraded operation.
 * @param config - Input value for the isChamberUpgraded operation.
 * @returns The computed StarMade-Decoder value.
 */
function isChamberUpgraded(block: BlockDefinition, config?: BlockConfig): boolean {
  const parent = block.metadata.chamberParent !== 0 ? config?.getById(block.metadata.chamberParent) : undefined;
  return parent?.metadata.chamberUpgradesTo === block.id;
}

/**
 * Handles the chamberCapacityBranch operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param block - Input value for the chamberCapacityBranch operation.
 * @param config - Input value for the chamberCapacityBranch operation.
 * @param seen - Input value for the chamberCapacityBranch operation.
 * @returns The computed StarMade-Decoder value.
 */
function chamberCapacityBranch(block: BlockDefinition, config?: BlockConfig, seen = new Set<number>()): number {
  if (seen.has(block.id)) return block.metadata.chamberCapacity;
  seen.add(block.id);
  const parent = block.metadata.chamberParent !== 0 ? config?.getById(block.metadata.chamberParent) : undefined;
  return block.metadata.chamberCapacity + (parent ? chamberCapacityBranch(parent, config, seen) : 0);
}

/**
 * Handles the chamberCapacityWithUpgrades operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param block - Input value for the chamberCapacityWithUpgrades operation.
 * @param config - Input value for the chamberCapacityWithUpgrades operation.
 * @param seen - Input value for the chamberCapacityWithUpgrades operation.
 * @returns The computed StarMade-Decoder value.
 */
function chamberCapacityWithUpgrades(block: BlockDefinition, config?: BlockConfig, seen = new Set<number>()): number {
  if (seen.has(block.id)) return block.metadata.chamberCapacity;
  seen.add(block.id);
  const parent = block.metadata.chamberParent !== 0 ? config?.getById(block.metadata.chamberParent) : undefined;
  if (parent?.metadata.chamberUpgradesTo === block.id) {
    return block.metadata.chamberCapacity + chamberCapacityWithUpgrades(parent, config, seen);
  }
  return block.metadata.chamberCapacity;
}

/**
 * Handles the chamberUpgradedRoot operation used by StarMade configuration loading, editing, and metadata enrichment.
 *
 * @param block - Input value for the chamberUpgradedRoot operation.
 * @param config - Input value for the chamberUpgradedRoot operation.
 * @param seen - Input value for the chamberUpgradedRoot operation.
 * @returns The computed StarMade-Decoder value.
 */
function chamberUpgradedRoot(block: BlockDefinition, config?: BlockConfig, seen = new Set<number>()): BlockReference {
  if (seen.has(block.id)) return createBlockReference(config, block.id);
  seen.add(block.id);
  const parent = block.metadata.chamberParent !== 0 ? config?.getById(block.metadata.chamberParent) : undefined;
  if (parent?.metadata.chamberUpgradesTo === block.id) {
    return chamberUpgradedRoot(parent, config, seen);
  }
  return createBlockReference(config, block.id);
}

/**
 * Builds the reactor-chamber ElementInfo section for one block.
 *
 * @param block - Parsed block definition.
 * @param config - Optional config used to resolve chamber tree references.
 * @returns Reactor chamber metadata, including capacity and upgrade chain.
 */
function createBlockChamberView(block: BlockDefinition, config?: BlockConfig): BlockChamberView {
  const any = block.isReactorChamberAny;
  return {
    any,
    general: block.isReactorChamberGeneral,
    specific: block.isReactorChamberSpecific,
    upgraded: isChamberUpgraded(block, config),
    root: createOptionalBlockReference(config, block.chamberRoot),
    parent: createOptionalBlockReference(config, block.metadata.chamberParent),
    upgradedRoot: any ? chamberUpgradedRoot(block, config) : null,
    upgradesTo: createOptionalBlockReference(config, block.metadata.chamberUpgradesTo),
    children: block.metadata.chamberChildren.map((id) => createBlockReference(config, id)),
    prerequisites: block.metadata.chamberPrerequisites.map((id) => createBlockReference(config, id)),
    mutuallyExclusive: block.metadata.chamberMutuallyExclusive.map((id) => createBlockReference(config, id)),
    appliesTo: createOptionalBlockReference(config, block.metadata.chamberAppliesTo),
    capacity: block.metadata.chamberCapacity,
    capacityBranch: chamberCapacityBranch(block, config),
    capacityWithUpgrades: chamberCapacityWithUpgrades(block, config),
    permission: block.metadata.chamberPermission,
    permittedEntityTypes: permittedEntityTypes(block.metadata.chamberPermission),
    configGroups: block.metadata.chamberConfigGroups,
    reactorHp: block.metadata.reactorHp,
    reactorGeneralIconIndex: block.metadata.reactorGeneralIconIndex,
  };
}

/**
 * Builds the tool-facing classification ElementInfo section for one block.
 *
 * @param block - Parsed block definition.
 * @param config - Optional config used to resolve computer references.
 * @returns Common boolean classifications and resolved computer metadata.
 */
function createBlockClassificationView(block: BlockDefinition, config?: BlockConfig): BlockClassificationView {
  return {
    armor: block.isArmor,
    placable: block.isPlacable,
    shoppable: block.inShop,
    deprecated: block.isDeprecated,
    door: block.metadata.door,
    beacon: block.metadata.beacon,
    enterable: block.metadata.enterable,
    sensorInput: block.metadata.sensorInput,
    systemBlock: block.metadata.systemBlock,
    reactorChamber: block.isReactorChamberAny,
    needsComputer: block.computerReference !== 0,
    computer: createOptionalBlockReference(config, block.computerReference),
    wildcardIds: block.metadata.wildcardIds,
  };
}

/**
 * Builds the complete ElementInformation-inspired view for one block.
 *
 * @param block - Parsed block definition.
 * @param config - Optional config used to resolve cross-block references.
 * @returns Domain-grouped ElementInfo object for renderers, editors, and analyzers.
 */
function createBlockElementInfo(block: BlockDefinition, config?: BlockConfig): BlockElementInfo {
  return {
    block,
    identity: {
      id: block.id,
      typeName: block.xmlTypeName,
      name: block.name,
      fullName: block.metadata.fullName || block.name,
      inventoryGroup: block.metadata.inventoryGroup,
      description: block.description,
    },
    render: createBlockRenderView(block),
    logic: createBlockLogicView(block, config),
    recipe: createBlockRecipeView(block, config),
    factory: createBlockFactoryView(block),
    collision: createBlockCollisionView(block),
    chamber: createBlockChamberView(block, config),
    classification: createBlockClassificationView(block, config),
  };
}

// ── BlockConfig ────────────────────────────────────────────────────────────────

/**
 * Immutable index of StarMade block definitions loaded from BlockConfig.xml.
 *
 * The collection keeps ID, display-name, and BlockTypes lookups in sync and
 * exposes ElementInfo views for render/editor code that should not know the XML
 * field layout.
 */
export class BlockConfig {
  /** Map from numeric ID to BlockDefinition. */
  private readonly _byId:   Map<number, BlockDefinition>;
  /** Map from lowercase name to BlockDefinition. */
  private readonly _byName: Map<string, BlockDefinition>;
  /** Map from XML/BlockTypes property key to BlockDefinition. */
  private readonly _byXmlType: Map<string, BlockDefinition>;

  /**
   * Creates lookup indexes for a parsed block list.
   *
   * @param blocks - Parsed block definitions to index.
   */
  private constructor(blocks: BlockDefinition[]) {
    this._byId   = new Map(blocks.map(b => [b.id,   b]));
    this._byName = new Map(blocks.map(b => [b.name.toLowerCase(), b]));
    this._byXmlType = new Map(blocks.map(b => [normalizeTypeName(b.xmlTypeName), b]));
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  /**
   * Loads vanilla BlockConfig.xml and custom block overrides from a StarMade installation.
   *
   * @param config - StarMade tool configuration with resolved game paths.
   * @returns Immutable block configuration index.
   */
  static load(config: SMToolConfig): BlockConfig {
    const vanillaPath    = path.join(config.paths.dataConfig, 'BlockConfig.xml');
    const blockTypesPath = path.join(config.paths.dataConfig, 'BlockTypes.properties');
    if (!fs.existsSync(vanillaPath)) {
      throw new Error(`BlockConfig.xml not found: ${vanillaPath}`);
    }
    const typeIds = BlockConfig._loadBlockTypes(blockTypesPath);
    const blocks  = BlockConfig._parseFile(vanillaPath, typeIds);
    const customPath = path.join(config.paths.custom.blockConfig, 'BlockConfigImport.xml');
    if (fs.existsSync(customPath)) {
      for (const cb of BlockConfig._parseFile(customPath, typeIds).values()) blocks.set(cb.id, cb);
    }
    return new BlockConfig([...blocks.values()]);
  }

  /**
   * Parses a BlockConfig XML string for tests or external tooling.
   *
   * @param xml - Raw BlockConfig XML text.
   * @param blockTypes - Optional BlockTypes key-to-ID mapping.
   * @returns Immutable block configuration index.
   */
  static fromXml(xml: string, blockTypes = new Map<string, number>()): BlockConfig {
    return new BlockConfig([...BlockConfig._parseXml(xml, blockTypes).values()]);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Returns a block definition by numeric block ID.
   *
   * @param id - Numeric type ID from BlockTypes.properties.
   * @returns Matching block definition, if known.
   */
  getById(id: number): BlockDefinition | undefined    { return this._byId.get(id); }
  /**
   * Returns a block definition by display name.
   *
   * @param name - Case-insensitive block display name.
   * @returns Matching block definition, if known.
   */
  getByName(name: string): BlockDefinition | undefined { return this._byName.get(name.toLowerCase()); }
  /**
   * Returns a block definition by BlockTypes XML key.
   *
   * @param typeName - XML type name or BlockTypes property key.
   * @returns Matching block definition, if known.
   */
  getByTypeName(typeName: string): BlockDefinition | undefined { return this._byXmlType.get(normalizeTypeName(typeName)); }
  /**
   * Returns all values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get all(): BlockDefinition[] { return [...this._byId.values()]; }
  /**
   * Returns ElementInformation-inspired views for every indexed block.
   *
   * @returns Resolved block metadata grouped by identity, render, logic, recipe, factory, collision, chamber, and classification domains.
   */
  get elementInfo(): BlockElementInfo[] { return this.all.map((block) => block.toElementInfo(this)); }
  /**
   * Returns the number of values exposed by this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  get size(): number { return this._byId.size; }
  /**
   * Returns the default iterator for this collection.
   *
   * @returns The computed StarMade-Decoder value.
   */
  [Symbol.iterator](): IterableIterator<BlockDefinition> { return this._byId.values(); }

  /** Resolves an XML BlockTypes key or numeric id to a stable block reference. */
  resolveReference(typeNameOrId: string | number): BlockReference {
    return createBlockReference(this, typeNameOrId);
  }

  /** Resolves a parsed ingredient to a stable block reference with count. */
  resolveIngredient(ingredient: BlockIngredient): BlockIngredientReference {
    return createBlockIngredientReference(this, ingredient);
  }

  /** Returns StarMade-Open-inspired element information for a block ID. */
  getElementInfoById(id: number): BlockElementInfo | undefined {
    return this.getById(id)?.toElementInfo(this);
  }

  /** Returns StarMade-Open-inspired element information for a display name. */
  getElementInfoByName(name: string): BlockElementInfo | undefined {
    return this.getByName(name)?.toElementInfo(this);
  }

  /** Returns StarMade-Open-inspired element information for a BlockTypes XML key. */
  getElementInfoByTypeName(typeName: string): BlockElementInfo | undefined {
    return this.getByTypeName(typeName)?.toElementInfo(this);
  }

  // ── Immutable Updates ────────────────────────────────────────────────────

  /**
   * Returns a new config with the supplied block inserted or replaced.
   *
   * @param block - Block definition to add or replace by ID.
   * @returns Updated immutable block configuration.
   */
  set(block: BlockDefinition): BlockConfig {
    const all = [...this._byId.values()];
    const idx = all.findIndex(b => b.id === block.id);
    if (idx >= 0) all[idx] = block; else all.push(block);
    return new BlockConfig(all);
  }

  /**
   * Returns a new config without the block matching the supplied ID.
   *
   * @param id - Numeric block ID to remove.
   * @returns Updated immutable block configuration.
   */
  delete(id: number): BlockConfig {
    return new BlockConfig([...this._byId.values()].filter(b => b.id !== id));
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Writes only blocks that differ from vanilla into customBlockConfig.
   *
   * @param config - StarMade tool configuration with resolved custom paths.
   * @param vanilla - Vanilla config used as the diff baseline.
   */
  saveCustom(config: SMToolConfig, vanilla: BlockConfig): void {
    const customDir = config.paths.custom.blockConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    const customBlocks = [...this._byId.values()].filter(b => {
      const orig = vanilla.getById(b.id);
      if (!orig) return true;
      return JSON.stringify(b) !== JSON.stringify(orig);
    });
    const xml = BlockConfig._toXml(customBlocks);
    fs.writeFileSync(path.join(customDir, 'BlockConfigImport.xml'), xml, 'utf8');
  }

  /**
   * Writes every indexed block into customBlockConfig/BlockConfigImport.xml.
   *
   * @param config - StarMade tool configuration with resolved custom paths.
   */
  saveAll(config: SMToolConfig): void {
    const customDir = config.paths.custom.blockConfig;
    if (!fs.existsSync(customDir)) fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, 'BlockConfigImport.xml'),
      BlockConfig._toXml([...this._byId.values()]),
      'utf8'
    );
  }

  // ── Internal Parsing ─────────────────────────────────────────────────────

  /** Loads BlockTypes.properties into Map<typeName, numericId>. */
  private static _loadBlockTypes(filePath: string): Map<string, number> {
    if (!fs.existsSync(filePath)) return new Map();
    return BlockConfig._parseBlockTypes(fs.readFileSync(filePath, 'utf8'));
  }

  /**
   * Parses BlockTypes for StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param content - Input value for the _parseBlockTypes operation.
   * @returns The computed StarMade-Decoder value.
   */
  static _parseBlockTypes(content: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const line of content.split('\n')) {
      const t  = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const name = t.slice(0, eq).trim();
      const id   = parseInt(t.slice(eq + 1).trim(), 10);
      if (name && !isNaN(id)) map.set(name, id);
    }
    return map;
  }

  /**
   * Parses File for StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param filePath - Input value for the _parseFile operation.
   * @param typeIds - Input value for the _parseFile operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _parseFile(filePath: string, typeIds: Map<string, number>): Map<number, BlockDefinition> {
    return BlockConfig._parseXml(fs.readFileSync(filePath, 'utf8'), typeIds);
  }

  /**
   * Parses Xml for StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param xml - Input value for the _parseXml operation.
   * @param typeIds - Input value for the _parseXml operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _parseXml(xml: string, typeIds: Map<string, number>): Map<number, BlockDefinition> {
    const result = XML_PARSER.parse(xml);
    const blocks = new Map<number, BlockDefinition>();
    BlockConfig._walkNode(result, typeIds, blocks);
    return blocks;
  }

  /**
   * Recursively walks the parsed XML tree.
   * A Block node has @_type = TypeName (for example "GREY_HULL") and @_name = display name.
   * The numeric ID is resolved through BlockTypes.properties (typeIds).
   * In BlockConfigImport.xml, @_type may also be a direct integer ID.
   */
  private static _walkNode(node: any, typeIds: Map<string, number>, blocks: Map<number, BlockDefinition>): void {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) BlockConfig._walkNode(item, typeIds, blocks);
      return;
    }

    const rawType = node['@_type'];
    const rawName = node['@_name'];

    if (rawType !== undefined && rawName !== undefined) {
      let id: number;
      const parsed = parseInt(String(rawType), 10);
      if (!isNaN(parsed) && parsed > 0) {
        id = parsed; // custom import using a direct numeric ID
      } else {
        id = typeIds.get(String(rawType)) ?? 0;
      }

      if (id > 0) {
        const block = BlockConfig._nodeToBlock(id, String(rawType), node);
        if (block) blocks.set(id, block);
      }
    }

    for (const key of Object.keys(node)) {
      if (!key.startsWith('@_')) BlockConfig._walkNode(node[key], typeIds, blocks);
    }
  }

  /**
   * Handles the nodeToBlock operation used by StarMade configuration loading, editing, and metadata enrichment.
   *
   * @param id - Input value for the _nodeToBlock operation.
   * @param typeName - Input value for the _nodeToBlock operation.
   * @param node - Input value for the _nodeToBlock operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _nodeToBlock(id: number, typeName: string, node: any): BlockDefinition | null {
    const g   = (key: string, def: any = '') => node[key] ?? def;
    const gb  = (key: string, def = false): boolean => {
      const v = node[key];
      if (v === undefined) return def;
      return v === true || String(v).toLowerCase() === 'true';
    };
    const gn  = (key: string, def = 0): number => {
      const v = node[key];
      if (v === undefined) return def;
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : def;
    };
    const gArr = (key: string): number[] => {
      const v = node[key];
      if (!v || String(v).trim() === '') return [];
      return String(v).split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    };
    const gFloatArr4 = (key: string, def: readonly [number, number, number, number]): [number, number, number, number] => {
      const v = node[key];
      if (!v || String(v).trim() === '') return [...def] as [number, number, number, number];
      const values = String(v).split(',').map(s => parseFloat(s.trim())).filter(n => Number.isFinite(n));
      return [
        values[0] ?? def[0],
        values[1] ?? def[1],
        values[2] ?? def[2],
        values[3] ?? def[3],
      ];
    };
    const chamberRoot = gn('ChamberRoot', 0);
    const metadata: BlockDefinitionMetadata = {
      fullName: String(g('FullName', '')),
      oldHitpoints: gn('OldHitpoints', 0),
      lowHpSetting: gn('LowHpSetting', 0),
      structureHpContribution: gn('StructureHPContribution', 0),
      explosionAbsorption: gn('ExplosionAbsorbtion', 0),
      blockResourceType: gn('BlockResourceType', 0),
      basicResourceFactory: gn('BasicResourceFactory', 0),
      producedInFactory: gn('ProducedInFactory', 0),
      factoryBakeTime: gn('FactoryBakeTime', 0),
      inRecipe: gb('InRecipe', false),
      physical: gb('Physical', false),
      cubeCubeCollision: gb('CubeCubeCollision', false),
      useDetailedCollisionForAstronautMode: gb('UseDetailedCollisionForAstronautMode', false),
      collisionDefault: parseCollisionShape(node.CollisionDefault),
      detailedCollisionForAstronautMode: parseCollisionShape(node.DetailedCollisionForAstronautMode),
      door: gb('Door', false),
      beacon: gb('Beacon', false),
      enterable: gb('Enterable', false),
      sensorInput: gb('SensorInput', false),
      systemBlock: gb('SystemBlock', false),
      sourceReference: gn('SourceReference', 0),
      inventoryGroup: String(g('InventoryGroup', '')),
      controlledBy: parseElementList(node.ControlledBy),
      controlling: parseElementList(node.Controlling),
      consistence: parseIngredientList(node.Consistence),
      cubatomConsistence: parseIngredientList(node.CubatomConsistence),
      recipeBuyResources: parseElementList(node.RecipeBuyResource),
      wildcardIds: gArr('WildcardIds'),
      mainCombinationController: gb('MainCombinationController', false),
      supportCombinationController: gb('SupportCombinationController', false),
      effectCombinationController: gb('EffectCombinationController', false),
      effectArmor: parseEffectArmor(node.EffectArmor),
      generalChamber: gb('GeneralChamber', false),
      chamberParent: gn('ChamberParent', 0),
      chamberChildren: parseBraceIntArray(node.ChamberChildren),
      chamberPrerequisites: parseBraceIntArray(node.ChamberPrerequisites),
      chamberMutuallyExclusive: parseBraceIntArray(node.ChamberMutuallyExclusive),
      chamberUpgradesTo: gn('ChamberUpgradesTo', 0),
      chamberAppliesTo: gn('ChamberAppliesTo', 0),
      chamberCapacity: gn('ChamberCapacity', 0),
      chamberPermission: gn('ChamberPermission', 0),
      chamberConfigGroups: parseElementList(node.ChamberConfigGroups),
      reactorHp: gn('ReactorHp', 0),
      reactorGeneralIconIndex: gn('ReactorGeneralIconIndex', 0),
      lodActivationAnimationStyle: gn('LodActivationAnimationStyle', 0),
    };

    return new BlockDefinition(
      id,
      String(node['@_name'] ?? ''),
      gn('@_icon'),
      gn('Hitpoints'),
      gn('Mass'),
      gn('Volume'),
      gn('Price'),
      String(g('Description')),
      gn('ArmorValue'),
      gb('Placable', true),
      gb('InShop', true),
      gb('Orientation', false),
      gb('CanActivate', false),
      gb('Deprecated', false),
      gn('BlockStyle'),
      gArr('SlabIds'),
      gArr('StyleIds'),
      gn('BlockComputerReference'),
      typeName,
      gArr('@_textureId'),
      gb('Transparency', false),
      gb('Animated', false),
      gn('IndividualSides', 1),
      gb('SideTexturesPointToOrientation', false),
      gb('HasActivationTexture', false),
      gb('LightSource', false),
      gFloatArr4('LightSourceColor', [1, 1, 1, 1]),
      String(g('LodShape', '')),
      String(g('LodShapeSwitchStyleActive', '')),
      gn('LodShapeFromFar', 0),
      gb('OnlyDrawnInBuildMode', false),
      gb('ExtendedTexture4x4', false),
      gn('ResourceInjection', 0),
      chamberRoot,
      chamberRoot !== 0,
      gb('LodCollisionPhysical', true),
      gn('Slab', 0),
      gb('DrawLogicConnection', false),
      gb('LogicBlock', false),
      gb('LogicSignaledByRail', false),
      gb('LogicBlockButton', false),
      metadata,
    );
  }

  // ── Serialization XML ─────────────────────────────────────────────────────

  /**
   * Converts this value to Xml.
   *
   * @param blocks - Input value for the _toXml operation.
   * @returns The computed StarMade-Decoder value.
   */
  private static _toXml(blocks: BlockDefinition[]): string {
    const xmlObj = {
      Config: {
        Element: {
          General: {
            Custom: {
              Block: blocks.map(b => ({
                '@_type':              b.id,
                '@_name':              b.name,
                '@_icon':              b.icon,
                '@_textureId':         b.textureIds.join(', '),
                Hitpoints:             b.hp,
                Mass:                  b.mass,
                Volume:                b.volume,
                Price:                 b.price,
                Description:           b.description,
                ArmorValue:            b.armor,
                Placable:              b.isPlacable,
                InShop:                b.inShop,
                Orientation:           b.hasOrientation,
                CanActivate:           b.canActivate,
                Deprecated:            b.isDeprecated,
                BlockStyle:            b.blockStyle,
                Slab:                  b.slab,
                Transparency:          b.transparent,
                Animated:              b.animated,
                IndividualSides:       b.individualSides,
                SideTexturesPointToOrientation: b.sideTexturesPointToOrientation,
                HasActivationTexture:  b.hasActivationTexture,
                DrawLogicConnection:   b.drawLogicConnection,
                LogicBlock:            b.logicBlock,
                LogicSignaledByRail:   b.logicSignaledByRail,
                LogicBlockButton:      b.logicBlockButton,
                LightSource:           b.lightSource,
                LightSourceColor:      b.lightSourceColor.join(','),
                LodShape:              b.lodShape,
                LodShapeSwitchStyleActive: b.lodShapeActive,
                LodShapeFromFar:       b.lodShapeStyle,
                LodActivationAnimationStyle: b.metadata.lodActivationAnimationStyle,
                OnlyDrawnInBuildMode:  b.drawOnlyInBuildMode,
                ExtendedTexture4x4:    b.extendedTexture,
                ResourceInjection:     b.resourceInjection,
                ChamberRoot:           b.chamberRoot,
                LodCollisionPhysical:  b.lodCollisionPhysical,
                FullName:              b.metadata.fullName,
                OldHitpoints:          b.metadata.oldHitpoints,
                LowHpSetting:          b.metadata.lowHpSetting,
                StructureHPContribution: b.metadata.structureHpContribution,
                ExplosionAbsorbtion:   b.metadata.explosionAbsorption,
                BlockResourceType:     b.metadata.blockResourceType,
                BasicResourceFactory:  b.metadata.basicResourceFactory,
                ProducedInFactory:     b.metadata.producedInFactory,
                FactoryBakeTime:       b.metadata.factoryBakeTime,
                InRecipe:              b.metadata.inRecipe,
                Physical:              b.metadata.physical,
                CubeCubeCollision:     b.metadata.cubeCubeCollision,
                UseDetailedCollisionForAstronautMode: b.metadata.useDetailedCollisionForAstronautMode,
                CollisionDefault:      collisionShapeToXml(b.metadata.collisionDefault),
                DetailedCollisionForAstronautMode: collisionShapeToXml(b.metadata.detailedCollisionForAstronautMode),
                Door:                  b.metadata.door,
                Beacon:                b.metadata.beacon,
                Enterable:             b.metadata.enterable,
                SensorInput:           b.metadata.sensorInput,
                SystemBlock:           b.metadata.systemBlock,
                SourceReference:       b.metadata.sourceReference,
                InventoryGroup:        b.metadata.inventoryGroup,
                ControlledBy:          elementsToXml(b.metadata.controlledBy),
                Controlling:           elementsToXml(b.metadata.controlling),
                Consistence:           ingredientsToXml(b.metadata.consistence),
                CubatomConsistence:    ingredientsToXml(b.metadata.cubatomConsistence),
                RecipeBuyResource:     elementsToXml(b.metadata.recipeBuyResources),
                WildcardIds:           b.metadata.wildcardIds.join(', '),
                MainCombinationController: b.metadata.mainCombinationController,
                SupportCombinationController: b.metadata.supportCombinationController,
                EffectCombinationController: b.metadata.effectCombinationController,
                EffectArmor:           effectArmorToXml(b.metadata.effectArmor),
                GeneralChamber:        b.metadata.generalChamber,
                ChamberParent:         b.metadata.chamberParent,
                ChamberChildren:       braceIntArrayToXml(b.metadata.chamberChildren),
                ChamberPrerequisites:  braceIntArrayToXml(b.metadata.chamberPrerequisites),
                ChamberMutuallyExclusive: braceIntArrayToXml(b.metadata.chamberMutuallyExclusive),
                ChamberUpgradesTo:     b.metadata.chamberUpgradesTo,
                ChamberAppliesTo:      b.metadata.chamberAppliesTo,
                ChamberCapacity:       b.metadata.chamberCapacity,
                ChamberPermission:     b.metadata.chamberPermission,
                ChamberConfigGroups:   elementsToXml(b.metadata.chamberConfigGroups),
                ReactorHp:             b.metadata.reactorHp,
                ReactorGeneralIconIndex: b.metadata.reactorGeneralIconIndex,
                SlabIds:               b.slabIds.join(', '),
                StyleIds:              b.styleIds.join(', '),
                BlockComputerReference: b.computerReference,
              })),
            },
          },
        },
      },
    };
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + XML_BUILDER.build(xmlObj);
  }

  /**
   * Builds the diagnostic string representation for this value.
   *
   * @returns The computed StarMade-Decoder value.
   */
  toString(): string { return `BlockConfig(${this._byId.size} blocks)`; }
}
