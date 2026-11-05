#include "SubtitleText.h"
#include <QRegularExpression>

std::optional<QString> subtitleRichText(const QString &ass)
{
    if (ass.size() > 16384) return std::nullopt;
    QString result, text;
    const auto flush = [&] {
        if (text.isEmpty()) return;
        result += QStringLiteral("<span style=\"color:#ffffff\">%1</span>").arg(text);
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
                // BBC speaker colours and inline emphasis must not override
                // the chosen plain-white style. Keep unsupported layout native.
                if (match.hasMatch() || tag == "c" || tag == "1c" || tag == "r"
                    || tag == "b0" || tag == "b1" || tag == "i0" || tag == "i1"
                    || tag == "u0" || tag == "u1" || tag == "s0" || tag == "s1") continue;
                return std::nullopt;
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
