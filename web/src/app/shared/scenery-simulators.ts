/**
 * The flight simulators a scenery can have a download link for, in the order shown: the field of the API and the name on
 * screen. The backend has the same fields (`data-management/sceneries/scenery-simulators.ts`).
 */
export const SCENERY_SIMULATORS = [
  { field: 'link_msfs_2024', label: 'MSFS 2024' },
  { field: 'link_msfs_2020', label: 'MSFS 2020' },
  { field: 'link_p3d_v6', label: 'P3D v6' },
  { field: 'link_p3d_v5', label: 'P3D v5' },
  { field: 'link_p3d_v4', label: 'P3D v4' },
  { field: 'link_p3d_v3', label: 'P3D v3' },
  { field: 'link_fsx', label: 'FSX' },
  { field: 'link_fs9', label: 'FS9' },
  { field: 'link_xplane', label: 'X-Plane' },
] as const;

export type SceneryLinkField = (typeof SCENERY_SIMULATORS)[number]['field'];

/** Versions of one simulator that can share a single link: the first field then holds it and the others are empty. */
export interface ScenerySharedGroup {
  flag: 'msfs_shared_link' | 'p3d_shared_link';
  fields: readonly [SceneryLinkField, ...SceneryLinkField[]];
  /** The name shown for the shared link. */
  label: string;
  /** The shared link must be filled in while the versions share it. */
  required: boolean;
}

export const SCENERY_SHARED_GROUPS: readonly ScenerySharedGroup[] = [
  {
    flag: 'msfs_shared_link',
    fields: ['link_msfs_2024', 'link_msfs_2020'],
    label: 'MSFS 2024 / 2020',
    required: true,
  },
  {
    flag: 'p3d_shared_link',
    fields: ['link_p3d_v6', 'link_p3d_v5', 'link_p3d_v4', 'link_p3d_v3'],
    label: 'P3D v6 - v3',
    // Shared from the start, so it cannot be required: a scenery need not have a P3D download.
    required: false,
  },
];

/** The link fields of a scenery as the API returns them, and which versions share one link. */
export type SceneryLinks = Record<SceneryLinkField, string | null> & Record<ScenerySharedGroup['flag'], boolean>;

/** One download link of a scenery, with the simulator (or the versions of it) it is for. */
export interface SceneryDownload {
  label: string;
  url: string;
}

/** The links a scenery really has, in the order of the simulators. */
export function sceneryDownloads(scenery: SceneryLinks): SceneryDownload[] {
  return SCENERY_SIMULATORS.flatMap(({ field, label }) => {
    const url = scenery[field];
    if (!url) {
      return [];
    }

    const group = SCENERY_SHARED_GROUPS.find(({ flag, fields }) => fields[0] === field && scenery[flag]);
    return [{ label: group?.label ?? label, url }];
  });
}
