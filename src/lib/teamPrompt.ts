// Prompt for the 2 photos -> chibi team picture, used on /register.
// MCXD (mixed doubles) = Player 2 is FEMALE, everything else is MALE + MALE.
export function teamPrompt(code: string): string {
  const mixed = code.toUpperCase() === 'MCXD'
  const p2 = mixed ? 'FEMALE' : 'MALE'
  return `Using the two uploaded photos, create ONE cute chibi TEAM PICTURE of the two players for a pickleball competition.

PLAYERS:
- Player 1 = FIRST uploaded photo = MALE
- Player 2 = SECOND uploaded photo = ${p2}
- Draw each player exactly as the gender stated above. For a MALE: hairstyle just follow back the actual photo, hair color also need to follow back exactly, masculine jawline, flat chest, straight eyebrows, no makeup, no long eyelashes, no feminine features or clothing. For a FEMALE: feminine features as in her photo, hairstyle and hair colour exactly as in her photo.
- Player 1 on the LEFT, Player 2 on the RIGHT. They are teammates, not a couple. No hearts, no romantic pose.

PRESERVE EXACTLY from each photo: hairstyle, hair colour, skin tone, face shape, eyeglasses (each player's own frame shape and colour) and shirt colour. Each player must clearly look like ${mixed ? 'their' : 'his'} own photo and different from the other.

COMPOSITION:
- Head and shoulders only. No arms, no hands, no legs.
- Cute chibi proportions: big head about 60% of the character's height, small shoulders.
- The two characters stand side by side, upright, facing the viewer, heads NOT tilted toward each other.
- SEPARATE characters: a clear gap of plain background between them. Shoulders NOT touching or overlapping. Nothing joining or connecting them.
- Square 1:1 canvas, centred, both characters the same size, together filling about 80% of the width.

STYLE:
- Ultra-cute Korean/Japanese chibi sticker illustration, premium custom avatar.
- NOT anime, NOT manga, NOT Pixar, NOT Disney, NOT 3D, NOT photorealistic.
- Solid black oval eyes, tiny nose, friendly smile, soft blush cheeks.
- Flat vector colours, clean colour blocking.
- Thick, clean, CLOSED black outline around each character, with no gaps.
- SHIRT BOTTOM: every shirt ends with a smooth curved thick black outline across its bottom edge, joining the left and right sides, so each shirt is a fully closed shape (essential for white or light shirts).

NO PROPS: no pickleball paddle, no ball, no net, no court, no objects of any kind. Only the two players.

BACKGROUND (for cutting out to transparent):
- Solid flat pure white #FFFFFF everywhere, including the gap between the two characters.
- No white sticker border or halo around the characters, no shadow, no glow, no gradient, no circle, no frame, no scenery.

NEGATIVE: wrong gender, couple pose, heads touching, shoulders overlapping, joined characters, open shirt bottom, sticker border, white halo, paddle, ball, props, background scenery, gradient, shadow, frame, text, letters, numbers, logo, watermark, realistic face, anime, 3D, thin outlines.`
}
