#include "SubtitleText.h"
#include <QRegularExpression>

std::optional<QString> subtitleRichText(const QString &ass)
{
    if (ass.size() > 16384) return std::nullopt;
    QString result, text, colour = "#ffffff";
    bool bold = false, italic = false, underline = false, strike = false;
    const auto flush = [&] {
        if (text.isEmpty()) return;
        result += QStringLiteral("<span style=\"color:%1;font-weight:%2;font-style:%3;text-decoration:%4\">%5</span>")
            .arg(colour, bold ? "bold" : "normal", italic ? "italic" : "normal",
                 underline && strike ? "underline line-through" : underline ? "underline" : strike ? "line-through" : "none", text);
        text.clear();
    };
    static const QRegularExpression colourTag(R"(^(?:1?c)&H([0-9a-fA-F]{1,6})&?$)");
    for (qsizetype i = 0; i < ass.size(); ++i) {
        const QChar ch = ass[i];
        if (ch == '{') {
            flush();
            const auto end = ass.indexOf('}', i + 1);
            if (end < 0) return std::nullopt;
            const auto block = ass.mid(i + 1, end - i - 1);
            if (!block.startsWith('\\')) return std::nullopt;
            for (const auto &tag : block.mid(1).split('\\')) {
                const auto match = colourTag.match(tag);
                if (match.hasMatch()) {
                    const auto bgr = match.captured(1).toUInt(nullptr, 16);
                    const auto rgb = ((bgr & 255) << 16) | (bgr & 0xff00) | (bgr >> 16);
                    colour = QStringLiteral("#%1").arg(rgb, 6, 16, QChar('0'));
                } else if (tag == "c" || tag == "1c") colour = "#ffffff";
                else if (tag == "b0" || tag == "b1") bold = tag.endsWith('1');
                else if (tag == "i0" || tag == "i1") italic = tag.endsWith('1');
                else if (tag == "u0" || tag == "u1") underline = tag.endsWith('1');
                else if (tag == "s0" || tag == "s1") strike = tag.endsWith('1');
                else if (tag == "r") {
                    colour = "#ffffff";
                    bold = italic = underline = strike = false;
                } else return std::nullopt;
            }
            i = end;
        } else if (ch == '\\' && i + 1 < ass.size()) {
            const QChar escaped = ass[++i];
            if (escaped == 'N' || escaped == 'n') text += "<br>";
            else if (escaped == 'h') text += "&#160;";
            else if (escaped == '{' || escaped == '}' || escaped == '\\') text += escaped;
            else return std::nullopt;
        } else if (ch == '\n') text += "<br>";
        else text += QString(ch).toHtmlEscaped();
    }
    flush();
    return result;
}
