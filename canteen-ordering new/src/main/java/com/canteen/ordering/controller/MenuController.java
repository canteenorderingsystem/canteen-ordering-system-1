package com.canteen.ordering.controller;

import com.canteen.ordering.exception.ResourceNotFoundException;
import com.canteen.ordering.model.MenuItem;
import com.canteen.ordering.repository.MenuItemRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/menu")
public class MenuController {

    private final MenuItemRepository menuItemRepository;

    public MenuController(MenuItemRepository menuItemRepository) {
        this.menuItemRepository = menuItemRepository;
    }

    @GetMapping
    public List<MenuItem> getMenu(@RequestParam(defaultValue = "false") boolean availableOnly) {
        return availableOnly
                ? menuItemRepository.findByAvailableTrueOrderByIdAsc()
                : menuItemRepository.findAllByOrderByIdAsc();
    }

    @GetMapping("/{id}")
    public MenuItem getMenuItem(@PathVariable Long id) {
        return menuItemRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item " + id + " was not found."));
    }
}
