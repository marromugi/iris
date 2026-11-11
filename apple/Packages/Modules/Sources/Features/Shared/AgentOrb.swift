import Backend
import SwiftUI

/// An agent's picture: a disc in one of the palettes, its colour running from a pale centre to the rim, with a fine
/// grain the look's seed lays out, drawn by a Metal shader (`AgentOrb.metal`). It holds still.
struct AgentOrb: View {
    let look: AgentLook
    var size: CGFloat = 36

    var body: some View {
        let palette = OrbPalette.of(look)
        let seed = Float(look.seed % 100_000)
        Rectangle()
            .visualEffect { content, proxy in
                content.colorEffect(
                    ShaderLibrary.bundle(.module).agentOrb(
                        .float2(proxy.size), .float(seed), .color(palette.center), .color(palette.middle),
                        .color(palette.rim)))
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The colours an orb runs through, from its centre to its rim, and the colours its agent's name is written in: a deep
/// one on light and a bright one on dark, each at least 4.8:1 against the background.
struct OrbPalette {
    let center: Color
    let middle: Color
    let rim: Color
    let lightInk: Color
    let darkInk: Color

    /// The colour the agent's name is written in, in this colour scheme.
    func ink(in scheme: ColorScheme) -> Color {
        scheme == .dark ? darkInk : lightInk
    }

    /// The palettes an agent's look picks from, by its number modulo how many there are.
    static let all: [OrbPalette] = [
        OrbPalette(0xFFE8A3, 0xFA7E1E, 0xD62976, ink: (0xD22874, 0xDF5894)),
        OrbPalette(0x9FE3FF, 0x635BFF, 0x2A1A7A, ink: (0x594CF0, 0x847BF4)),
        OrbPalette(0xFFD567, 0xFF7139, 0xE31587, ink: (0xCA3F1B, 0xE5603E)),
        OrbPalette(0xE8FFF4, 0x7FE0B8, 0xFF8A7A, ink: (0xD03925, 0xE06252)),
        OrbPalette(0xD6F7FF, 0x00B4D8, 0xC6F432, ink: (0x007A94, 0x0097B8)),
        OrbPalette(0xFFD1F0, 0xB05CFF, 0x3D2BFF, ink: (0x8842F0, 0xA36DF3)),
        OrbPalette(0xFFF3C4, 0xFF9EBB, 0x7A5CFF, ink: (0x6848E0, 0x8F78E8)),
        OrbPalette(0xF2FFD6, 0x1DB954, 0x0B4F3C, ink: (0x13813B, 0x18A04A)),
    ]

    static func of(_ look: AgentLook) -> OrbPalette {
        all[look.palette % all.count]
    }

    private init(_ center: Int, _ middle: Int, _ rim: Int, ink: (light: Int, dark: Int)) {
        self.center = Color(hex: center)
        self.middle = Color(hex: middle)
        self.rim = Color(hex: rim)
        lightInk = Color(hex: ink.light)
        darkInk = Color(hex: ink.dark)
    }
}

extension AgentLook {
    /// A look picked at random: any palette, any seed.
    static func random() -> AgentLook {
        AgentLook(palette: Int.random(in: 0..<OrbPalette.all.count), seed: Int.random(in: 0...Int(Int32.max)))
    }
}

extension Color {
    fileprivate init(hex: Int) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

#if DEBUG
    #Preview {
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(96)), count: 4)) {
            ForEach(0..<OrbPalette.all.count, id: \.self) { palette in
                AgentOrb(look: AgentLook(palette: palette, seed: palette * 7919), size: 88)
            }
        }
        .padding()
    }
#endif
