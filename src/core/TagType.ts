/**
 * @fileoverview Tag Type
 *
 * Provides low-level binary, tag, and serialization primitives used by StarMade file parsers and writers.
 *
 * @author InitSysRev
 * @version 1.0.0
 */

/**
 * TagType — exact port of the Java Tag.Type enum
 *
 * Ordinals match the bytes on the binary wire.
 * Source: org.schema.schine.resource.tag.Tag.Type
 */

export enum TagType {
  FINISH      = 0,
  BYTE        = 1,
  SHORT       = 2,
  INT         = 3,
  LONG        = 4,
  FLOAT       = 5,
  DOUBLE      = 6,
  BYTE_ARRAY  = 7,
  STRING      = 8,
  VECTOR3f    = 9,
  VECTOR3i    = 10,
  VECTOR3b    = 11,
  LIST        = 12,
  STRUCT      = 13,
  SERIALIZABLE = 14,
  VECTOR4f    = 15,
  MATRIX4f    = 16,
  NOTHING     = 17,
  MATRIX3f    = 18,
}

/** Human-readable names for debugging and display, matching Java getTypeString() */
export const TAG_TYPE_NAMES: Record<TagType, string> = {
  [TagType.FINISH]:       'TAG_End',
  [TagType.BYTE]:         'TAG_Byte',
  [TagType.SHORT]:        'TAG_Short',
  [TagType.INT]:          'TAG_Int',
  [TagType.LONG]:         'TAG_Long',
  [TagType.FLOAT]:        'TAG_Float',
  [TagType.DOUBLE]:       'TAG_Double',
  [TagType.BYTE_ARRAY]:   'TAG_Byte_Array',
  [TagType.STRING]:       'TAG_String',
  [TagType.VECTOR3f]:     'TAG_Vector3f',
  [TagType.VECTOR3i]:     'TAG_Vector3i',
  [TagType.VECTOR3b]:     'TAG_Vector3b',
  [TagType.LIST]:         'TAG_List',
  [TagType.STRUCT]:       'TAG_Compound',
  [TagType.SERIALIZABLE]: 'TAG_Serializable',
  [TagType.VECTOR4f]:     'TAG_Vector4f',
  [TagType.MATRIX4f]:     'TAG_Matrix4f',
  [TagType.NOTHING]:      'TAG_NOTHING',
  [TagType.MATRIX3f]:     'TAG_Matrix3f',
};

/** Number of valid types */
export const TAG_TYPE_COUNT = 19;
