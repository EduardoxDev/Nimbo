import SwiftUI
import WidgetKit

@main
struct NimboWidgets: WidgetBundle {
  var body: some Widget {
    MascotWidget()
    StatusWidget()
    NimboLiveActivity()
  }
}
