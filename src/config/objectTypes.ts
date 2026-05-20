export const OBJECT_TYPES = {
  ground:   { color: 0x555555, static: true, interactable: false, interactionType: null },
  platform: { color: 0x888888, static: true, interactable: false, interactionType: null },
  hazard:   { color: 0xff2222, static: true, interactable: true, interactionType: 'hazard' },
  key:      { color: 0xffdd00, static: true, interactable: true, interactionType: 'key' },
  door:     { color: 0x00ccff, static: true, interactable: true, interactionType: 'door' },
}
