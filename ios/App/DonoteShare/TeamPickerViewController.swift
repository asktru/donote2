import UIKit

/// The "Team" row's picker inside the share compose sheet: a plain list of
/// the user's team workspaces with a checkmark on the current choice.
class TeamPickerViewController: UITableViewController {
    private let teams: [(slug: String, name: String)]
    private let selectedSlug: String
    private let onPick: (String) -> Void

    init(
        teams: [(slug: String, name: String)],
        selectedSlug: String,
        onPick: @escaping (String) -> Void
    ) {
        self.teams = teams
        self.selectedSlug = selectedSlug
        self.onPick = onPick
        super.init(style: .plain)
        title = "Team"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func tableView(
        _ tableView: UITableView,
        numberOfRowsInSection section: Int
    ) -> Int {
        teams.count
    }

    override func tableView(
        _ tableView: UITableView,
        cellForRowAt indexPath: IndexPath
    ) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "team")
            ?? UITableViewCell(style: .default, reuseIdentifier: "team")
        let team = teams[indexPath.row]

        cell.textLabel?.text = team.name
        cell.accessoryType = team.slug == selectedSlug ? .checkmark : .none

        return cell
    }

    override func tableView(
        _ tableView: UITableView,
        didSelectRowAt indexPath: IndexPath
    ) {
        tableView.deselectRow(at: indexPath, animated: true)
        onPick(teams[indexPath.row].slug)
    }
}
